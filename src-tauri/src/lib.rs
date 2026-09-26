mod workspace_planner;
mod workspace_commands;
mod service;
mod credentials;
mod file_access;
mod file_export;
mod commands;
mod analysis;
mod category_colors;
mod category_order;
mod enrichment_preview;
mod derived_columns;
mod plot_commands;
mod external_links;
mod source_file;
mod remote_sources;
mod opened_files;
mod cli;
use tauri::Manager;
use std::sync::Arc;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(opened_files::OpenFileInbox::default())
        .setup(|app| {
            let storage=app.path().app_data_dir()?.join("projects");
            std::fs::create_dir_all(&storage)?;
            let httpfs=app.path().resource_dir()?.join("httpfs/osx_arm64/httpfs.duckdb_extension");
            app.manage(Arc::new(service::AppService::new(storage).with_httpfs_path(httpfs)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            remote_sources::import_dataset_url,
            opened_files::take_opened_files, opened_files::acknowledge_opened_files,
            cli::cli_setup,
            workspace_commands::create_query_dataset,workspace_planner::suggest_workspace_query,
            external_links::open_external_url,
            plot_commands::query_plot,plot_commands::export_plot,
            enrichment_preview::suggest_enrichment,enrichment_preview::preview_enrichment,
            derived_columns::suggest_column,derived_columns::preview_derived_column,derived_columns::create_derived_column,
            category_colors::suggest_category_colors,
            category_order::suggest_category_order,
            analysis::analysis_preview_cast,analysis::analysis_cast,analysis::analysis_classify,analysis::analysis_filter,analysis::analysis_models,
            source_file::reveal_dataset_source,
            commands::remember_source_access,commands::open_dataset,commands::dataset_storage,commands::list_sheets,commands::get_dataset,commands::get_last_source,
            commands::query_page,commands::get_distributions,commands::load_view,commands::save_view,commands::list_shared_revisions,commands::select_shared_revision,commands::export_dataset,
            commands::list_enrichments,commands::save_enrichment,commands::delete_enrichment,
            commands::save_provider_key,commands::has_provider_key,commands::check_provider_key_access,commands::remove_provider_key,
            commands::plan_run,commands::start_run,commands::get_run_status,commands::pause_run,commands::resume_run,commands::cancel_run,
            commands::list_runs,commands::get_cells,commands::get_cell_history
        ])
        .build(tauri::generate_context!())
        .expect("No se pudo iniciar Datolens")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                opened_files::receive(app, &urls);
            }
        });
}
