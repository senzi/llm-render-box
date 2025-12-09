import Dexie from 'dexie';
import { defineStore } from 'pinia';

const db = new Dexie('LLMRunnerDB');
db.version(1).stores({
  pages: 'id, createdAt, updatedAt',
});

const blankHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Snippet</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 2rem; line-height: 1.6; }
    h1 { font-size: 2rem; }
    .muted { color: #666; }
  </style>
</head>
<body>
  <h1>Hello</h1>
  <p class="muted">Replace this HTML with your snippet to start previewing.</p>
</body>
</html>`;

export const usePageStore = defineStore('pageStore', {
  state: () => ({
    pages: [],
    currentPageId: null,
    loading: false,
  }),
  getters: {
    currentPage(state) {
      return state.pages.find((p) => p.id === state.currentPageId) || null;
    },
  },
  actions: {
    async loadPages() {
      this.loading = true;
      try {
        const list = await db.pages.toArray();
        list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        this.pages = list;
      } finally {
        this.loading = false;
      }
    },
    async createNewPage(title = 'Untitled Snippet', code = blankHtml) {
      const now = Date.now();
      const page = {
        id: crypto.randomUUID(),
        title,
        code,
        thumbnail: null,
        createdAt: now,
        updatedAt: now,
      };
      await db.pages.add(page);
      this.pages.unshift(page);
      this.currentPageId = page.id;
      return page;
    },
    async updatePage(id, payload) {
      const idx = this.pages.findIndex((p) => p.id === id);
      if (idx === -1) return null;
      const updated = {
        ...this.pages[idx],
        ...payload,
        updatedAt: Date.now(),
      };
      this.pages.splice(idx, 1, updated);
      this.pages.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      await db.pages.put(updated);
      return updated;
    },
    async deletePage(id) {
      this.pages = this.pages.filter((p) => p.id !== id);
      if (this.currentPageId === id) {
        this.currentPageId = null;
      }
      await db.pages.delete(id);
    },
    async setCurrentPage(id) {
      this.currentPageId = id;
    },
    async importJsonPayload(payload) {
      if (!payload || !Array.isArray(payload.pages)) {
        throw new Error('Invalid backup format');
      }
      const imported = [];
      for (const page of payload.pages) {
        const pageWithId = {
          ...page,
          id: crypto.randomUUID(),
          createdAt: page.createdAt || Date.now(),
          updatedAt: page.updatedAt || Date.now(),
        };
        await db.pages.add(pageWithId);
        imported.push(pageWithId);
      }
      await this.loadPages();
      return imported.length;
    },
    async exportAll() {
      const pages = await db.pages.toArray();
      return { pages };
    },
  },
});
