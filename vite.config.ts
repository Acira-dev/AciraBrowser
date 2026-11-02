import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  optimizeDeps: { entries: ["index.html"] },
  plugins: [{
    name: 'acira-manual-preview-refresh',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/@acira-live-client', (_request, response) => {
        response.setHeader('Content-Type', 'text/javascript');
        response.end(`const channel=new BroadcastChannel('acira-live-preview');
channel.onmessage=event=>{if(event.data==='refresh')location.reload();};`);
      });
    },
    transformIndexHtml() { return [{ tag: 'script', attrs: { type: 'module', src: '/@acira-live-client' }, injectTo: 'head' }]; },
    handleHotUpdate(context) {
      if (!context.file.includes('/src/')) return;
      for (const module of context.modules) context.server.moduleGraph.invalidateModule(module);
      // This is a shared, manually refreshed test build. Keep one coherent set of
      // CSS and JavaScript while the person evaluates its intermediate frames.
      return [];
    },
  }],
  server: {
    host: "127.0.0.1",
    port: 5194,
    strictPort: true,
    watch: {
      ignored: [
        "**/docs/**",
        "**/.qa-profiles/**",
        "**/.profile/**",
        "**/.preview-profile/**",
      ],
    },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
      },
    },
  },
});
