mod service;
mod commands;
use tauri::Manager;
use std::sync::Arc;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let storage=app.path().app_data_dir()?.join("projects");
            std::fs::create_dir_all(&storage)?;
            app.manage(Arc::new(service::AppService::new(storage)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_dataset,commands::list_sheets,commands::get_dataset,commands::get_last_source,
            commands::query_page,commands::get_distributions,commands::load_view,commands::save_view,commands::export_dataset,
            commands::list_enrichments,commands::save_enrichment,commands::delete_enrichment,
            commands::save_provider_key,commands::has_provider_key,commands::remove_provider_key,
            commands::plan_run,commands::start_run,commands::get_run_status,commands::pause_run,commands::resume_run,commands::cancel_run,
            commands::list_runs,commands::get_cells,commands::get_cell_history
        ])
        .run(tauri::generate_context!())
        .expect("No se pudo iniciar Datolens");
}
