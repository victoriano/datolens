import { Menu, MenuItem, Submenu } from '@tauri-apps/api/menu';
import type { Language } from './preferences';

const spanish: Record<string, string> = {
  File: 'Archivo', Edit: 'Edición', View: 'Ver', Window: 'Ventana', Help: 'Ayuda',
  Undo: 'Deshacer', Redo: 'Rehacer', Cut: 'Cortar', Copy: 'Copiar', Paste: 'Pegar',
  'Select All': 'Seleccionar todo', Minimize: 'Minimizar', Maximize: 'Maximizar',
  Zoom: 'Zoom', 'Toggle Full Screen': 'Alternar pantalla completa',
  'Enter Full Screen': 'Entrar en pantalla completa', 'Exit Full Screen': 'Salir de pantalla completa',
  Hide: 'Ocultar', 'Hide Others': 'Ocultar las demás', 'Show All': 'Mostrar todo',
  Close: 'Cerrar', 'Close Window': 'Cerrar ventana', Quit: 'Salir', Exit: 'Salir',
  About: 'Acerca de', Services: 'Servicios', 'Bring All to Front': 'Traer todo al frente',
  'Settings…': 'Ajustes…',
};

export function nativeMenuLabel(source: string, language: Language): string {
  if (language === 'en') return source;
  const label = source.replaceAll('&', '');
  if (Object.hasOwn(spanish, label)) return spanish[label];
  for (const [prefix, translation] of [['About ', 'Acerca de '], ['Hide ', 'Ocultar '], ['Quit ', 'Salir de ']]) {
    if (label.startsWith(prefix)) return translation + label.slice(prefix.length);
  }
  return source;
}

type Item = Awaited<ReturnType<Menu['items']>>[number];
type MenuSnapshot = { menu: Menu; labels: Array<{ item: Item; source: string }>; installed: boolean };
let defaultMenu: Promise<MenuSnapshot> | undefined;
let queue = Promise.resolve();

async function snapshotMenu(): Promise<MenuSnapshot> {
  const menu = await Menu.default();
  const labels: MenuSnapshot['labels'] = [];
  async function capture(parent: Menu | Submenu) {
    for (const item of await parent.items()) {
      try {
        const source = await item.text();
        if (source) labels.push({ item, source });
      } catch { /* An OS-owned item may not expose its label. */ }
      if (item instanceof Submenu) await capture(item);
    }
  }
  await capture(menu);
  const appMenu = (await menu.items()).find((item): item is Submenu => item instanceof Submenu);
  if (appMenu) {
    const settings = await MenuItem.new({ id: 'datolens-settings', text: 'Settings…', accelerator: 'CmdOrCtrl+,', action: () => window.dispatchEvent(new Event('datolens:open-settings')) });
    await appMenu.insert(settings, 1);
    labels.push({ item: settings, source: 'Settings…' });
  }
  return { menu, labels, installed: false };
}

/** The shell uses Tauri's default menu. Keep its native items, accelerators and
 * callbacks; capture source labels once so repeated switches are reversible. */
export function setNativeMenuLanguage(language: Language): Promise<void> {
  queue = queue.catch(() => {}).then(async () => {
    defaultMenu ??= snapshotMenu().catch(error => { defaultMenu = undefined; throw error; });
    const state = await defaultMenu;
    for (const { item, source } of state.labels) {
      try { await item.setText(nativeMenuLabel(source, language)); }
      catch { /* Preserve functionality if a native item cannot be renamed. */ }
    }
    if (!state.installed) {
      const previous = await state.menu.setAsAppMenu();
      state.installed = true;
      await previous?.close();
    }
  });
  return queue;
}
