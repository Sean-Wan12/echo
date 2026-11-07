// Theme only this window's native sidebar, retaining its other browser colors.
export function sidebarTheme(api) {
  const windows = new Map();
  const queues = new Map();
  const enqueue = (id, task) => {
    const next = (queues.get(id) || Promise.resolve()).catch(() => {}).then(task);
    queues.set(id, next);
    return next.finally(() => { if (queues.get(id) === next) queues.delete(id); });
  };
  const owns = (theme, saved) => theme.colors?.sidebar === saved.applied;
  return {
    apply(id, dark) {
      return enqueue(id, async () => {
        const current = await api.getCurrent(id);
        let saved = windows.get(id);
        if (!saved || !owns(current, saved)) saved = { original: current };
        const colors = dark
          ? { sidebar: '#1b1b20', sidebar_text: '#efedf1', sidebar_border: '#393942', sidebar_highlight: '#303039', sidebar_highlight_text: '#efedf1' }
          : { sidebar: '#f8f8fa', sidebar_text: '#24242a', sidebar_border: '#dedee6', sidebar_highlight: '#f0eff3', sidebar_highlight_text: '#24242a' };
        await api.update(id, { ...saved.original, colors: { ...saved.original.colors, ...colors } });
        saved.applied = colors.sidebar;
        windows.set(id, saved);
      });
    },
    restore(id) {
      return enqueue(id, async () => {
        const saved = windows.get(id);
        if (!saved) return;
        windows.delete(id);
        // Do not replace a browser theme selected while Echo was open.
        if (!owns(await api.getCurrent(id), saved)) return;
        if (Object.keys(saved.original).length) await api.update(id, saved.original);
        else await api.reset(id);
      });
    }
  };
}
