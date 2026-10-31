using System;
using System.Collections.Specialized;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

internal static class PinDownloaderClipboard
{
    private const uint MaxMessageBytes = 1024u * 1024u;
    private const string HelperVersion = "1.0.0";

    [STAThread]
    private static int Main()
    {
        Stream input = Console.OpenStandardInput();
        Stream output = Console.OpenStandardOutput();

        try
        {
            while (true)
            {
                byte[] header = ReadExactly(input, 4);
                if (header == null) break;

                uint length = BitConverter.ToUInt32(header, 0);
                if (length == 0 || length > MaxMessageBytes) break;

                byte[] payload = ReadExactly(input, (int)length);
                if (payload == null) break;

                string requestJson = Encoding.UTF8.GetString(payload);
                string responseJson;
                try
                {
                    responseJson = HandleRequest(requestJson);
                }
                catch (Exception ex)
                {
                    responseJson = ErrorResponse(ex.Message);
                }

                WriteMessage(output, responseJson);
            }
            return 0;
        }
        catch (Exception ex)
        {
            try
            {
                WriteMessage(output, ErrorResponse(ex.Message));
            }
            catch
            {
            }
            return 1;
        }
    }

    private static string HandleRequest(string json)
    {
        string action = GetJsonString(json, "action").ToLowerInvariant();
        if (action == "ping")
        {
            return "{\"ok\":true,\"platform\":\"windows\",\"version\":\"" + HelperVersion + "\"}";
        }

        if (action != "copyfile") throw new ArgumentException("Unsupported action.");

        string path = GetJsonString(json, "path");
        if (String.IsNullOrWhiteSpace(path)) throw new ArgumentException("Missing file path.");
        if (!Path.IsPathRooted(path)) throw new ArgumentException("The file path must be absolute.");

        path = Path.GetFullPath(path);
        if (!String.Equals(Path.GetExtension(path), ".mp4", StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("Only MP4 files can be copied.");
        }
        if (!File.Exists(path)) throw new FileNotFoundException("The video file was not found.", path);

        var info = new FileInfo(path);
        if (info.Length <= 0) throw new InvalidDataException("The video file is empty.");

        SetClipboardFile(path);

        return "{\"ok\":true,\"platform\":\"windows\",\"version\":\"" + HelperVersion +
            "\",\"path\":\"" + JsonEscape(path) + "\",\"bytes\":" +
            info.Length.ToString(CultureInfo.InvariantCulture) + "}";
    }

    private static string GetJsonString(string json, string key)
    {
        string pattern = "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"";
        Match match = Regex.Match(json, pattern);
        return match.Success ? Regex.Unescape(match.Groups[1].Value) : String.Empty;
    }

    private static void SetClipboardFile(string path)
    {
        var files = new StringCollection();
        files.Add(path);

        Exception lastError = null;
        for (int attempt = 0; attempt < 10; attempt++)
        {
            try
            {
                Clipboard.SetFileDropList(files);
                return;
            }
            catch (Exception ex)
            {
                lastError = ex;
                Thread.Sleep(100);
            }
        }

        throw new InvalidOperationException("Could not open the Windows clipboard.", lastError);
    }

    private static string ErrorResponse(string message)
    {
        return "{\"ok\":false,\"error\":\"" + JsonEscape(message) + "\"}";
    }

    private static string JsonEscape(string value)
    {
        var builder = new StringBuilder();
        foreach (char character in value)
        {
            switch (character)
            {
                case '\\': builder.Append("\\\\"); break;
                case '"': builder.Append("\\\""); break;
                case '\b': builder.Append("\\b"); break;
                case '\f': builder.Append("\\f"); break;
                case '\n': builder.Append("\\n"); break;
                case '\r': builder.Append("\\r"); break;
                case '\t': builder.Append("\\t"); break;
                default:
                    if (character < 0x20)
                    {
                        builder.Append("\\u");
                        builder.Append(((int)character).ToString("x4", CultureInfo.InvariantCulture));
                    }
                    else
                    {
                        builder.Append(character);
                    }
                    break;
            }
        }
        return builder.ToString();
    }

    private static byte[] ReadExactly(Stream stream, int count)
    {
        var buffer = new byte[count];
        int offset = 0;

        while (offset < count)
        {
            int read = stream.Read(buffer, offset, count - offset);
            if (read <= 0)
            {
                if (offset == 0) return null;
                throw new EndOfStreamException("Unexpected end of native message.");
            }
            offset += read;
        }

        return buffer;
    }

    private static void WriteMessage(Stream stream, string json)
    {
        byte[] body = Encoding.UTF8.GetBytes(json);
        byte[] header = BitConverter.GetBytes((uint)body.Length);
        stream.Write(header, 0, header.Length);
        stream.Write(body, 0, body.Length);
        stream.Flush();
    }
}
