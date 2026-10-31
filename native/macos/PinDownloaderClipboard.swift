import AppKit
import Foundation

let helperVersion = "1.0.0"
let maxMessageBytes = 1024 * 1024

struct HelperError: Error {
    let message: String
}

func readExactly(_ handle: FileHandle, _ count: Int) -> Data? {
    var data = Data()
    while data.count < count {
        let chunk = handle.readData(ofLength: count - data.count)
        if chunk.isEmpty {
            return nil
        }
        data.append(chunk)
    }
    return data
}

func readLength(_ header: Data) -> UInt32 {
    var value: UInt32 = 0
    for index in 0..<4 {
        value |= UInt32(header[index]) << (8 * index)
    }
    return value
}

func writeMessage(_ response: [String: Any]) throws {
    let body = try JSONSerialization.data(withJSONObject: response, options: [])
    var length = UInt32(body.count).littleEndian
    let header = Data(bytes: &length, count: MemoryLayout<UInt32>.size)
    let output = FileHandle.standardOutput
    output.write(header)
    output.write(body)
}

func stringValue(_ request: [String: Any], _ key: String) -> String {
    return (request[key] as? String) ?? ""
}

func pingResponse() -> [String: Any] {
    return [
        "ok": true,
        "platform": "macos",
        "version": helperVersion
    ]
}

func copyFile(path: String) throws -> [String: Any] {
    guard path.hasPrefix("/") else {
        throw HelperError(message: "The file path must be absolute.")
    }

    let url = URL(fileURLWithPath: path).standardizedFileURL
    guard url.pathExtension.lowercased() == "mp4" else {
        throw HelperError(message: "Only MP4 files can be copied.")
    }

    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory),
          !isDirectory.boolValue else {
        throw HelperError(message: "The video file was not found.")
    }

    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    let byteCount = (attributes[.size] as? NSNumber)?.int64Value ?? 0
    guard byteCount > 0 else {
        throw HelperError(message: "The video file is empty.")
    }

    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    let objects: [NSPasteboardWriting] = [url as NSURL]
    guard pasteboard.writeObjects(objects) else {
        throw HelperError(message: "Could not write the file to the macOS clipboard.")
    }

    return [
        "ok": true,
        "platform": "macos",
        "version": helperVersion,
        "path": url.path,
        "bytes": byteCount
    ]
}

func errorMessage(_ error: Error) -> String {
    if let helperError = error as? HelperError {
        return helperError.message
    }
    return error.localizedDescription
}

@main
struct PinDownloaderClipboardHost {
    static func main() {
        let input = FileHandle.standardInput

        while true {
            guard let header = readExactly(input, 4), header.count == 4 else {
                break
            }

            let length = readLength(header)
            if length == 0 || length > UInt32(maxMessageBytes) {
                break
            }

            guard let payload = readExactly(input, Int(length)) else {
                break
            }

            let response: [String: Any]
            do {
                guard let request = try JSONSerialization.jsonObject(with: payload, options: []) as? [String: Any] else {
                    throw HelperError(message: "Invalid request.")
                }

                let action = stringValue(request, "action").lowercased()
                if action == "ping" {
                    response = pingResponse()
                } else if action == "copyfile" {
                    response = try copyFile(path: stringValue(request, "path"))
                } else {
                    throw HelperError(message: "Unsupported action.")
                }
            } catch {
                response = [
                    "ok": false,
                    "error": errorMessage(error)
                ]
            }

            do {
                try writeMessage(response)
            } catch {
                break
            }
        }
    }
}
