use crate::service::{error, Result};

fn web_url(value:&str)->Result<tauri::Url> {
    if value.len()>8192 {return Err("El enlace es demasiado largo.".into());}
    let url=tauri::Url::parse(value).map_err(|_|"El enlace no es válido.")?;
    if !matches!(url.scheme(),"http"|"https") || url.host_str().is_none() {return Err("Solo se pueden abrir enlaces web HTTP o HTTPS.".into());}
    Ok(url)
}
#[tauri::command]
pub async fn open_external_url(url:String)->Result<()> {
    let url=web_url(&url)?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os="macos")]
        {
            let status=std::process::Command::new("/usr/bin/open").arg(url.as_str()).status().map_err(error)?;
            if status.success() {Ok(())} else {Err("No se pudo abrir el enlace en el navegador.".into())}
        }
        #[cfg(not(target_os="macos"))]
        {let _=url;Err("La apertura externa está disponible en macOS.".into())}
    }).await.map_err(error)?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_web_links_can_reach_the_external_browser() {
        for url in ["file:///tmp/test", "javascript:alert(1)", "data:text/html,test", "-a Finder", "relative/path"] {assert!(web_url(url).is_err());}
        assert_eq!(web_url("https://example.org/path?q=a%20b#source").unwrap().as_str(),"https://example.org/path?q=a%20b#source");
    }
}
