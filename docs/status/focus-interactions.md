# Focus after pointer interaction

- Pointer clicks no longer show the blue focus outline on controls, including the Settings close button and text fields. Tabbing restores the keyboard focus outline.
- Verified with `bun run build` and an isolated browser interaction: opening Settings by click left the close button unoutlined; clicking an API key field left it unoutlined; Tab to the next field showed the outline.
- The running native Datolens process still uses its previous bundled frontend. The shared bundle was left untouched while that process was open, so native activation remains pending a coordinated rebuild and relaunch.
- Interactive buttons and disclosure controls now use the pointer cursor, including the Settings close button. Disabled buttons retain the default cursor. Verified computed styles in the isolated browser view for the Settings close button, Settings trigger, tab close button, and disabled Save button.
