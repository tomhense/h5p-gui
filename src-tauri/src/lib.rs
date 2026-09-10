use std::{fs::{self, File}, io::{Read, Seek, SeekFrom, Write}, net::{TcpListener, TcpStream}, path::{Path, PathBuf}, sync::{Arc, Mutex}, thread, time::{SystemTime, UNIX_EPOCH}};
use zip::ZipArchive;

static ARCHIVE_SERVER: Mutex<Option<(Arc<std::sync::atomic::AtomicBool>, PathBuf)>> = Mutex::new(None);

#[tauri::command]
fn cli_file_path() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|argument| !argument.starts_with('-'))
}

#[tauri::command]
fn serve_h5p(path: String) -> Result<String, String> {
    stop_archive_server();
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
    let root = std::env::temp_dir().join(format!("h5p-desk-{stamp}"));
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let file = File::open(&path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        let Some(relative) = entry.enclosed_name().map(|p| p.to_owned()) else { continue };
        let target = root.join(relative);
        if entry.is_dir() { fs::create_dir_all(&target).map_err(|e| e.to_string())?; continue }
        if let Some(parent) = target.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        let mut output = File::create(target).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut output).map_err(|e| e.to_string())?;
    }
    let listener = TcpListener::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let stopping = Arc::new(std::sync::atomic::AtomicBool::new(false));
    spawn_listener(listener, stopping.clone(), root.clone());
    if let Ok(listener_v6) = TcpListener::bind(format!("[::1]:{port}")) { spawn_listener(listener_v6, stopping.clone(), root.clone()); }
    *ARCHIVE_SERVER.lock().unwrap() = Some((stopping, root));
    Ok(format!("http://127.0.0.1:{port}"))
}

fn spawn_listener(listener: TcpListener, stopping: Arc<std::sync::atomic::AtomicBool>, root: PathBuf) {
    thread::spawn(move || {
        for stream in listener.incoming() {
            if stopping.load(std::sync::atomic::Ordering::Relaxed) { break; }
            if let Ok(stream) = stream { serve_request(stream, &root); }
        }
    });
}

fn stop_archive_server() {
    if let Some((stopping, root)) = ARCHIVE_SERVER.lock().unwrap().take() {
        stopping.store(true, std::sync::atomic::Ordering::Relaxed);
        let _ = fs::remove_dir_all(root);
    }
}

fn serve_request(mut stream: TcpStream, root: &Path) {
    let mut request = [0u8; 8192];
    let Ok(size) = stream.read(&mut request) else { return };
    let request = String::from_utf8_lossy(&request[..size]);
    let mut lines = request.lines();
    let Some(first) = lines.next() else { return };
    let mut parts = first.split_whitespace();
    let method = parts.next();
    if method == Some("OPTIONS") { write_response(&mut stream, "204 No Content", "text/plain", &[]); return; }
    if method != Some("GET") && method != Some("HEAD") { return }
    let send_body = method == Some("GET");
    let Some(url) = parts.next() else { return };
    let relative = url.split('?').next().unwrap_or("/").trim_start_matches('/');
    let relative = percent_decode(relative);
    let path = root.join(&relative);
    if !path.starts_with(root) { return }
    let Ok(mut file) = File::open(&path) else { write_response(&mut stream, "404 Not Found", "text/plain", &[]); return };
    let Ok(length) = file.metadata().map(|m| m.len()) else { return };
    let range = lines.find_map(|line| line.strip_prefix("Range: bytes=").and_then(|v| v.strip_suffix('\r').or(Some(v))).and_then(|v| parse_range(v, length)));
    let (start, end, status) = range.map(|(s, e)| (s, e, "206 Partial Content")).unwrap_or((0, length.saturating_sub(1), "200 OK"));
    if start >= length { write_response(&mut stream, "416 Range Not Satisfiable", "text/plain", &[]); return }
    let _ = file.seek(SeekFrom::Start(start));
    let mut body = vec![0; (end - start + 1) as usize];
    if send_body && file.read_exact(&mut body).is_err() { return }
    let mime = mime_type(&path);
    let headers = format!("HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nContent-Range: bytes {start}-{end}/{length}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, OPTIONS\r\nAccess-Control-Allow-Headers: Range\r\nConnection: close\r\n\r\n", body.len());
    let _ = stream.write_all(headers.as_bytes()); if send_body { let _ = stream.write_all(&body); }
}
fn write_response(stream: &mut TcpStream, status: &str, mime: &str, body: &[u8]) { let h = format!("HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, OPTIONS\r\nAccess-Control-Allow-Headers: Range\r\nConnection: close\r\n\r\n", body.len()); let _ = stream.write_all(h.as_bytes()); let _ = stream.write_all(body); }
fn parse_range(value: &str, length: u64) -> Option<(u64, u64)> {
    let mut parts = value.split('-');
    let start = parts.next()?.parse::<u64>().ok();
    let end: Option<u64> = parts.next().and_then(|part| if part.is_empty() { None } else { part.parse().ok() });
    match (start, end) {
        (Some(start), Some(end)) if start <= end && start < length => Some((start, end.min(length - 1))),
        (Some(start), None) if start < length => Some((start, length - 1)),
        (None, Some(size)) if size > 0 => Some((length.saturating_sub(size), length - 1)),
        _ => None
    }
}
fn percent_decode(value: &str) -> String { value.replace("%20", " ").replace("%2F", "/").replace("%5C", "\\") }
fn mime_type(path: &Path) -> &'static str { match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase().as_str() { "mp4" => "video/mp4", "webm" => "video/webm", "mp3" => "audio/mpeg", "wav" => "audio/wav", "json" => "application/json", "js" => "text/javascript", "css" => "text/css", "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", "svg" => "image/svg+xml", _ => "application/octet-stream" } }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    if std::env::var_os("WAYLAND_DISPLAY").is_some() && std::env::var_os("GDK_BACKEND").is_none() {
        // GTK otherwise prefers X11 when both DISPLAY and WAYLAND_DISPLAY are
        // present, which makes Tauri run through XWayland.
        std::env::set_var("GDK_BACKEND", "wayland");
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![cli_file_path, serve_h5p])
        .build(tauri::generate_context!())
        .expect("error while building H5P Desk")
        .run(|_, event| {
            if matches!(event, tauri::RunEvent::Exit) { stop_archive_server(); }
        });
}
