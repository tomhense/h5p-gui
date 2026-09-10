fn main() {
    // Some GTK/WebKit combinations abort with a Wayland protocol error while
    // creating the first window. Prefer the compatible X11 backend when the
    // desktop session exposes both display protocols.
    if std::env::var_os("GDK_BACKEND").is_none()
        && std::env::var_os("WAYLAND_DISPLAY").is_some()
        && std::env::var_os("DISPLAY").is_some()
    {
        std::env::set_var("GDK_BACKEND", "x11");
    }
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    h5p_desk_lib::run();
}
