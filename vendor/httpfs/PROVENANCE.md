# DuckDB httpfs for macOS ARM64

- DuckDB/extension target: v1.5.5, osx_arm64 (matches vendored libduckdb).
- Official source: https://extensions.duckdb.org/v1.5.5/osx_arm64/httpfs.duckdb_extension.gz
- Downloaded 2026-09-23 over HTTPS.
- Archive SHA256: `758acc0b0c4fbf09506f387ff6f52826b1038b7b6849ded39928d2f992945230`.
- Uncompressed SHA256: `10514b4ef19f80bf4ec4bf90c124f5d34625f2606263b40ae8ec7979905bb779`.
- `LOAD` tested with the project's v1.5.5 dynamic library, automatic installation/loading disabled and normal DuckDB extension signature checks enabled. No `INSTALL`, no unsigned-extension setting.
- Preserve the extension bytes: changing Mach-O signatures can invalidate DuckDB's signed payload. The enclosing app bundles this resource as downloaded.
- Intel builds require a separately pinned extension for their DuckDB platform. This artifact was verified on ARM64 only.

Recreate with `prepare.sh`; all downloads are checksum checked before replacing the resource.
