//! Complete exports in an app-private staging directory, then publish once.
//! NSSavePanel grants the exact destination, not arbitrary siblings beside it.
use crate::service::{error, Result};
use std::{fs, path::{Path, PathBuf}};

const EXISTS: &str = "El destino ya existe. Elige un nombre nuevo para conservar el archivo original.";
struct StagingDirectory(PathBuf);
impl Drop for StagingDirectory {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
}
#[cfg(target_os = "macos")]
fn volume_staging_directory(target: &Path) -> Result<StagingDirectory> {
    use objc2_foundation::{NSFileManager, NSSearchPathDirectory, NSSearchPathDomainMask, NSURL};
    objc2::rc::autoreleasepool(|_| {
        let parent = target.parent().ok_or("Ruta de exportación no válida.")?;
        let destination = NSURL::from_directory_path(parent).ok_or("Ruta de exportación no válida.")?;
        let directory = NSFileManager::defaultManager()
            .URLForDirectory_inDomain_appropriateForURL_create_error(
                NSSearchPathDirectory::ItemReplacementDirectory,
                NSSearchPathDomainMask::UserDomainMask,
                Some(&destination), true,
            ).map_err(|_| "macOS no pudo preparar un espacio temporal para exportar en ese volumen.")?;
        let path = directory.to_file_path().ok_or("Ruta temporal de exportación no válida.")?;
        // Foundation owns this temporary location on the destination's volume.
        // This fallback never receives the final filename or requests access to
        // the whole destination folder from the user.
        let directory = StagingDirectory(path);
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory.0, fs::Permissions::from_mode(0o700)).map_err(error)?;
        Ok(directory)
    })
}
#[cfg(not(target_os = "macos"))]
fn volume_staging_directory(target: &Path) -> Result<StagingDirectory> {
    let parent = target.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    Ok(StagingDirectory(tempfile::tempdir_in(parent).map_err(error)?.keep()))
}

pub fn publish(storage: &Path, target: &Path, generate: impl FnOnce(&Path) -> Result<()>) -> Result<String> {
    // symlink_metadata also rejects a dangling symlink. The final no-clobber
    // operation enforces this again atomically if another writer wins the race.
    match fs::symlink_metadata(target) {
        Ok(_) => return Err(EXISTS.into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(error(e)),
    }
    fs::create_dir_all(storage).map_err(error)?;
    let directory = tempfile::Builder::new().prefix("export-").tempdir_in(storage).map_err(error)?;
    let staged = directory.path().join("completed-export");
    generate(&staged)?;
    if !fs::symlink_metadata(&staged).map_err(error)?.is_file() {
        return Err("La exportación no produjo un archivo regular.".into());
    }
    fs::File::open(&staged).map_err(error)?.sync_all().map_err(error)?;
    // tempfile uses renameatx_np(RENAME_EXCL) on macOS, with a no-clobber
    // hard-link fallback. Neither path publishes a partial copy or overwrites.
    match tempfile::TempPath::try_from_path(&staged).map_err(error)?.persist_noclobber(target) {
        Ok(()) => {},
        Err(failure) if failure.error.kind() == std::io::ErrorKind::CrossesDevices => {
            // Foundation receives an EXISTING parent solely to choose the volume.
            // Passing a nonexistent final filename may create a placeholder there.
            let volume = volume_staging_directory(target)?;
            let copy = volume.0.join("completed-export");
            fs::copy(&failure.path, &copy).map_err(error)?;
            fs::File::open(&copy).map_err(error)?.sync_all().map_err(error)?;
            tempfile::TempPath::try_from_path(copy).map_err(error)?
                .persist_noclobber(target).map_err(|e| publication_error(e.error))?;
        },
        Err(failure) => return Err(publication_error(failure.error)),
    }
    Ok(target.to_string_lossy().into_owned())
}

fn publication_error(error: std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::AlreadyExists { EXISTS.into() }
    else { format!("No se pudo publicar la exportación completa: {error}") }
}

pub fn dataset(storage: &Path, data: &datolens_data::DataStore, mut request: datolens_data::ExportRequest) -> Result<String> {
    let destination = PathBuf::from(&request.path);
    publish(storage, &destination, |staged| {
        request.path = staged.to_string_lossy().into_owned();
        data.export(request).map(|_| ()).map_err(error)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_generation_leaves_no_destination_or_temporary_siblings() {
        let target_dir = tempfile::tempdir().unwrap();
        let target = target_dir.path().join("result.csv");
        let mut staging = PathBuf::new();
        let result = publish(&tempfile::tempdir().unwrap().path(), &target, |path| {
            staging = path.parent().unwrap().into();
            fs::write(path, b"unfinished").unwrap();
            Err("generation failed".into())
        });
        assert!(result.is_err());
        assert!(!target.exists());
        assert!(!staging.exists());
        assert_eq!(fs::read_dir(target_dir.path()).unwrap().count(), 0);
    }
    #[test]
    fn destination_created_during_generation_is_never_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("result.csv");
        let failure = publish(&tempfile::tempdir().unwrap().path(), &target, |path| {
            fs::write(path, b"complete export").unwrap();
            fs::write(&target, b"another writer's original").unwrap();
            Ok(())
        }).unwrap_err();
        assert_eq!(failure, EXISTS);
        assert_eq!(fs::read(&target).unwrap(), b"another writer's original");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[test]
    fn publishes_a_complete_file_and_removes_staging() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("result.csv");
        let mut staging = PathBuf::new();
        publish(&tempfile::tempdir().unwrap().path(), &target, |path| {
            staging = path.parent().unwrap().into();
            #[cfg(target_os = "macos")] {
                use std::os::unix::fs::MetadataExt;
                assert_ne!(staging, target.parent().unwrap());
                assert_eq!(fs::metadata(&staging).unwrap().dev(), fs::metadata(dir.path()).unwrap().dev());
            }
            fs::write(path, b"id,amount\n1,20\n").map_err(error)
        }).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"id,amount\n1,20\n");
        assert!(!staging.exists());
    }
    #[cfg(unix)]
    #[test]
    fn refuses_existing_files_and_dangling_symlinks_before_generating() {
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join("original.csv");
        fs::write(&original, b"original").unwrap();
        assert!(publish(&tempfile::tempdir().unwrap().path(), &original, |_| panic!("must not generate")).is_err());
        let link = dir.path().join("dangling.csv");
        std::os::unix::fs::symlink(dir.path().join("absent.csv"), &link).unwrap();
        assert!(publish(&tempfile::tempdir().unwrap().path(), &link, |_| panic!("must not generate")).is_err());
        assert_eq!(fs::read(&original).unwrap(), b"original");
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn volume_staging_never_creates_a_placeholder_at_the_selected_name() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("not-created.csv");
        let staging = volume_staging_directory(&target).unwrap();
        assert!(!target.exists());
        assert_ne!(staging.0, dir.path());
        assert_eq!(fs::metadata(&staging.0).unwrap().dev(), fs::metadata(dir.path()).unwrap().dev());
        assert_eq!(fs::metadata(&staging.0).unwrap().permissions().mode() & 0o777, 0o700);
    }
    #[test]
    fn filtered_projected_csv_and_parquet_roundtrip_without_changing_the_source() {
        use datolens_data::{DataStore, ExportRequest, ExportFormat, Filter, SortRule, PageRequest};
        let temp = tempfile::tempdir().unwrap();
        let storage = temp.path().join("app-private");
        let source = temp.path().join("original.csv");
        let original = "id,amount,city\n9007199254740993,10,Madrid\n9007199254740995,20,Sevilla\n9007199254740997,30,Madrid\n";
        fs::write(&source, original).unwrap();
        let data = DataStore::open(&source, None, &temp.path().join("cache")).unwrap();
        for (format, extension) in [(ExportFormat::Csv, "csv"), (ExportFormat::Parquet, "parquet")] {
            let target = temp.path().join(format!("filtered.{extension}"));
            let request = ExportRequest { path: target.to_string_lossy().into(), format,
                filters: vec![Filter::Categorical { column: "city".into(), selected: vec!["Madrid".into()] }],
                sorting: vec![SortRule { id: "amount".into(), desc: true }], columns: vec!["id".into(), "amount".into()] };
            dataset(&storage, &data, request.clone()).unwrap();
            let reopened = DataStore::open(&target, None, &temp.path().join("reopened-cache")).unwrap();
            let output = reopened.dataset();
            assert_eq!(output.row_count, Some(2));
            assert_eq!(output.columns.len(), 2);
            let page = reopened.query_page(PageRequest { dataset_id: output.id, columns: vec!["id".into()], filters: vec![], sorting: vec![], offset: 0, limit: 10 }).unwrap();
            assert_eq!(page.rows[0].values["id"], serde_json::json!("9007199254740997"));
            assert_eq!(page.rows[1].values["id"], serde_json::json!("9007199254740993"));
            let mut protected = request;
            protected.path = source.to_string_lossy().into();
            assert!(dataset(&storage, &data, protected).is_err());
        }
        assert_eq!(fs::read_to_string(&source).unwrap(), original);
        assert_eq!(fs::read_dir(storage).unwrap().count(), 0);
    }
}
