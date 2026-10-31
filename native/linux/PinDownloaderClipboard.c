#define _POSIX_C_SOURCE 200809L
#define _XOPEN_SOURCE 700

#include <ctype.h>
#include <errno.h>
#include <limits.h>
#include <signal.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#ifndef PATH_MAX
#define PATH_MAX 4096
#endif

#define HELPER_VERSION "1.0.0"
#define MAX_MESSAGE_BYTES (1024u * 1024u)

static int read_exact(int fd, void *buffer, size_t count) {
    unsigned char *bytes = (unsigned char *)buffer;
    size_t offset = 0;

    while (offset < count) {
        ssize_t result = read(fd, bytes + offset, count - offset);
        if (result < 0) {
            if (errno == EINTR) continue;
            return -1;
        }
        if (result == 0) {
            return offset == 0 ? 0 : -1;
        }
        offset += (size_t)result;
    }

    return 1;
}

static int write_all(int fd, const void *buffer, size_t count) {
    const unsigned char *bytes = (const unsigned char *)buffer;
    size_t offset = 0;

    while (offset < count) {
        ssize_t result = write(fd, bytes + offset, count - offset);
        if (result < 0) {
            if (errno == EINTR) continue;
            return -1;
        }
        offset += (size_t)result;
    }

    return 0;
}

static int write_message(const char *json) {
    size_t length = strlen(json);
    unsigned char header[4];

    header[0] = (unsigned char)(length & 0xffu);
    header[1] = (unsigned char)((length >> 8) & 0xffu);
    header[2] = (unsigned char)((length >> 16) & 0xffu);
    header[3] = (unsigned char)((length >> 24) & 0xffu);

    if (write_all(STDOUT_FILENO, header, sizeof(header)) != 0) return -1;
    return write_all(STDOUT_FILENO, json, length);
}

static int append_utf8(char *output, size_t output_size, size_t *offset, unsigned int code) {
    unsigned char encoded[4];
    size_t length;

    if (code == 0) return -1;
    if (code <= 0x7fu) {
        encoded[0] = (unsigned char)code;
        length = 1;
    } else if (code <= 0x7ffu) {
        encoded[0] = (unsigned char)(0xc0u | (code >> 6));
        encoded[1] = (unsigned char)(0x80u | (code & 0x3fu));
        length = 2;
    } else if (code <= 0xffffu) {
        encoded[0] = (unsigned char)(0xe0u | (code >> 12));
        encoded[1] = (unsigned char)(0x80u | ((code >> 6) & 0x3fu));
        encoded[2] = (unsigned char)(0x80u | (code & 0x3fu));
        length = 3;
    } else if (code <= 0x10ffffu) {
        encoded[0] = (unsigned char)(0xf0u | (code >> 18));
        encoded[1] = (unsigned char)(0x80u | ((code >> 12) & 0x3fu));
        encoded[2] = (unsigned char)(0x80u | ((code >> 6) & 0x3fu));
        encoded[3] = (unsigned char)(0x80u | (code & 0x3fu));
        length = 4;
    } else {
        return -1;
    }

    if (*offset + length >= output_size) return -1;
    memcpy(output + *offset, encoded, length);
    *offset += length;
    return 0;
}

static int hex_value(char character) {
    if (character >= '0' && character <= '9') return character - '0';
    if (character >= 'a' && character <= 'f') return character - 'a' + 10;
    if (character >= 'A' && character <= 'F') return character - 'A' + 10;
    return -1;
}

static int json_get_string(const char *json, const char *key, char *output, size_t output_size) {
    char needle[64];
    const char *cursor;
    size_t offset = 0;

    if (snprintf(needle, sizeof(needle), "\"%s\"", key) >= (int)sizeof(needle)) return -1;

    cursor = strstr(json, needle);
    if (cursor == NULL) return -1;
    cursor += strlen(needle);

    while (*cursor != '\0' && isspace((unsigned char)*cursor)) cursor++;
    if (*cursor != ':') return -1;
    cursor++;
    while (*cursor != '\0' && isspace((unsigned char)*cursor)) cursor++;
    if (*cursor != '"') return -1;
    cursor++;

    while (*cursor != '\0' && *cursor != '"') {
        unsigned char character = (unsigned char)*cursor++;

        if (character == '\\') {
            char escape = *cursor++;
            switch (escape) {
                case '"': character = '"'; break;
                case '\\': character = '\\'; break;
                case '/': character = '/'; break;
                case 'b': character = '\b'; break;
                case 'f': character = '\f'; break;
                case 'n': character = '\n'; break;
                case 'r': character = '\r'; break;
                case 't': character = '\t'; break;
                case 'u': {
                    unsigned int code = 0;
                    int index;

                    for (index = 0; index < 4; index++) {
                        int value = hex_value(*cursor++);
                        if (value < 0) return -1;
                        code = (code << 4) | (unsigned int)value;
                    }

                    if (code >= 0xd800u && code <= 0xdbffu &&
                        cursor[0] == '\\' && cursor[1] == 'u') {
                        unsigned int low = 0;
                        const char *saved = cursor;

                        cursor += 2;
                        for (index = 0; index < 4; index++) {
                            int value = hex_value(*cursor++);
                            if (value < 0) {
                                cursor = saved;
                                low = 0;
                                break;
                            }
                            low = (low << 4) | (unsigned int)value;
                        }

                        if (low >= 0xdc00u && low <= 0xdfffu) {
                            code = 0x10000u + ((code - 0xd800u) << 10) + (low - 0xdc00u);
                        } else {
                            cursor = saved;
                        }
                    }

                    if (append_utf8(output, output_size, &offset, code) != 0) return -1;
                    continue;
                }
                default:
                    return -1;
            }
        }

        if (offset + 1 >= output_size) return -1;
        output[offset++] = (char)character;
    }

    if (*cursor != '"') return -1;
    output[offset] = '\0';
    return 0;
}

static int json_escape(const char *input, char *output, size_t output_size) {
    size_t offset = 0;

    while (*input != '\0') {
        unsigned char character = (unsigned char)*input++;
        const char *escape = NULL;
        char unicode_escape[8];

        switch (character) {
            case '"': escape = "\\\""; break;
            case '\\': escape = "\\\\"; break;
            case '\b': escape = "\\b"; break;
            case '\f': escape = "\\f"; break;
            case '\n': escape = "\\n"; break;
            case '\r': escape = "\\r"; break;
            case '\t': escape = "\\t"; break;
            default:
                if (character < 0x20u) {
                    snprintf(unicode_escape, sizeof(unicode_escape), "\\u%04x", character);
                    escape = unicode_escape;
                }
                break;
        }

        if (escape != NULL) {
            size_t length = strlen(escape);
            if (offset + length >= output_size) return -1;
            memcpy(output + offset, escape, length);
            offset += length;
        } else {
            if (offset + 1 >= output_size) return -1;
            output[offset++] = (char)character;
        }
    }

    output[offset] = '\0';
    return 0;
}

static void respond_error(const char *format, ...) {
    char message[4096];
    char escaped[8192];
    char response[9216];
    va_list arguments;

    va_start(arguments, format);
    vsnprintf(message, sizeof(message), format, arguments);
    va_end(arguments);

    if (json_escape(message, escaped, sizeof(escaped)) != 0) {
        strcpy(escaped, "Clipboard helper failed.");
    }

    snprintf(response, sizeof(response), "{\"ok\":false,\"error\":\"%s\"}", escaped);
    write_message(response);
}

static char *find_command(const char *name) {
    const char *path = getenv("PATH");
    char *copy;
    char *directory;
    char *save = NULL;
    char *result = NULL;

    if (path == NULL || *path == '\0') path = "/usr/local/bin:/usr/bin:/bin";
    copy = strdup(path);
    if (copy == NULL) return NULL;

    for (directory = strtok_r(copy, ":", &save);
         directory != NULL;
         directory = strtok_r(NULL, ":", &save)) {
        size_t length = strlen(directory) + strlen(name) + 2;
        char *candidate = (char *)malloc(length);

        if (candidate == NULL) break;
        snprintf(candidate, length, "%s/%s", directory[0] == '\0' ? "." : directory, name);
        if (access(candidate, X_OK) == 0) {
            result = candidate;
            break;
        }
        free(candidate);
    }

    free(copy);
    return result;
}

static int is_uri_safe(unsigned char character) {
    return isalnum(character) || character == '-' || character == '.' ||
           character == '_' || character == '~' || character == '/';
}

static char *build_file_uri(const char *path) {
    size_t length = strlen(path);
    char *uri = (char *)malloc(7 + length * 3 + 1);
    size_t offset = 7;
    size_t index;

    if (uri == NULL) return NULL;
    memcpy(uri, "file://", 7);

    for (index = 0; index < length; index++) {
        unsigned char character = (unsigned char)path[index];
        if (is_uri_safe(character)) {
            uri[offset++] = (char)character;
        } else {
            static const char hex[] = "0123456789ABCDEF";
            uri[offset++] = '%';
            uri[offset++] = hex[(character >> 4) & 0x0fu];
            uri[offset++] = hex[character & 0x0fu];
        }
    }

    uri[offset] = '\0';
    return uri;
}

static int run_clipboard_tool(const char *tool, char *const arguments[], const char *data) {
    int pipe_fds[2];
    pid_t child;
    int write_result;
    int status = 0;
    int wait_result;

    if (pipe(pipe_fds) != 0) return -1;

    child = fork();
    if (child < 0) {
        close(pipe_fds[0]);
        close(pipe_fds[1]);
        return -1;
    }

    if (child == 0) {
        if (dup2(pipe_fds[0], STDIN_FILENO) < 0) _exit(127);
        close(pipe_fds[0]);
        close(pipe_fds[1]);
        execv(tool, arguments);
        _exit(127);
    }

    close(pipe_fds[0]);
    write_result = write_all(pipe_fds[1], data, strlen(data));
    close(pipe_fds[1]);

    do {
        wait_result = waitpid(child, &status, 0);
    } while (wait_result < 0 && errno == EINTR);

    if (write_result != 0 || wait_result < 0) return -1;
    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) return -1;
    return 0;
}

static int copy_file(const char *path) {
    char resolved[PATH_MAX];
    char escaped_path[PATH_MAX * 2 + 1];
    char response[PATH_MAX * 2 + 512];
    struct stat info;
    const char *wayland_display = getenv("WAYLAND_DISPLAY");
    const char *x11_display = getenv("DISPLAY");
    char *tool = NULL;
    char *uri = NULL;
    char *data = NULL;
    size_t path_length = strlen(path);

    if (path_length < 4 || strcasecmp(path + path_length - 4, ".mp4") != 0) {
        respond_error("Only MP4 files can be copied.");
        return 0;
    }
    if (path[0] != '/') {
        respond_error("The file path must be absolute.");
        return 0;
    }
    if (realpath(path, resolved) == NULL) {
        respond_error("The video file was not found.");
        return 0;
    }
    if (stat(resolved, &info) != 0 || !S_ISREG(info.st_mode)) {
        respond_error("The video file was not found.");
        return 0;
    }
    if (info.st_size <= 0) {
        respond_error("The video file is empty.");
        return 0;
    }

    if (wayland_display != NULL && *wayland_display != '\0') {
        tool = find_command("wl-copy");
    }
    if (tool == NULL && x11_display != NULL && *x11_display != '\0') {
        tool = find_command("xclip");
    }
    if (tool == NULL) {
        tool = find_command("wl-copy");
    }
    if (tool == NULL) {
        tool = find_command("xclip");
    }
    if (tool == NULL) {
        respond_error("Install wl-clipboard (Wayland) or xclip (X11) to copy files.");
        return 0;
    }

    uri = build_file_uri(resolved);
    if (uri == NULL) {
        free(tool);
        respond_error("Could not prepare the file for the clipboard.");
        return 0;
    }

    data = (char *)malloc(strlen(uri) + 3);
    if (data == NULL) {
        free(uri);
        free(tool);
        respond_error("Could not prepare the file for the clipboard.");
        return 0;
    }
    sprintf(data, "%s\r\n", uri);

    if (strstr(tool, "wl-copy") != NULL) {
        char *arguments[] = { tool, "--type", "text/uri-list", NULL };
        if (run_clipboard_tool(tool, arguments, data) != 0) {
            free(data);
            free(uri);
            free(tool);
            respond_error("Could not write the file to the clipboard.");
            return 0;
        }
    } else {
        char *arguments[] = {
            tool, "-selection", "clipboard", "-t", "text/uri-list", "-i", NULL
        };
        if (run_clipboard_tool(tool, arguments, data) != 0) {
            free(data);
            free(uri);
            free(tool);
            respond_error("Could not write the file to the clipboard.");
            return 0;
        }
    }

    if (json_escape(resolved, escaped_path, sizeof(escaped_path)) != 0) {
        strcpy(escaped_path, "");
    }

    snprintf(
        response,
        sizeof(response),
        "{\"ok\":true,\"platform\":\"linux\",\"version\":\"%s\",\"path\":\"%s\",\"bytes\":%lld}",
        HELPER_VERSION,
        escaped_path,
        (long long)info.st_size
    );
    write_message(response);

    free(data);
    free(uri);
    free(tool);
    return 0;
}

int main(void) {
    signal(SIGPIPE, SIG_IGN);

    for (;;) {
        unsigned char header[4];
        uint32_t length;
        char *request;
        char action[32];

        int read_result = read_exact(STDIN_FILENO, header, sizeof(header));
        if (read_result <= 0) break;

        length = (uint32_t)header[0] |
                 ((uint32_t)header[1] << 8) |
                 ((uint32_t)header[2] << 16) |
                 ((uint32_t)header[3] << 24);
        if (length == 0 || length > MAX_MESSAGE_BYTES) break;

        request = (char *)malloc((size_t)length + 1);
        if (request == NULL) break;
        if (read_exact(STDIN_FILENO, request, length) != 1) {
            free(request);
            break;
        }
        request[length] = '\0';

        if (json_get_string(request, "action", action, sizeof(action)) != 0) {
            respond_error("Invalid request.");
        } else if (strcasecmp(action, "ping") == 0) {
            if (write_message(
                    "{\"ok\":true,\"platform\":\"linux\",\"version\":\"" HELPER_VERSION "\"}"
                ) != 0) {
                free(request);
                break;
            }
        } else if (strcasecmp(action, "copyfile") == 0) {
            char path[PATH_MAX];
            if (json_get_string(request, "path", path, sizeof(path)) != 0) {
                respond_error("Missing file path.");
            } else {
                copy_file(path);
            }
        } else {
            respond_error("Unsupported action.");
        }

        free(request);
    }

    return 0;
}
