// Loads the course data from content/. Everything is cached after the first fetch.
// content/courses.json lists every course; each course lives in its own folder (content/courses/<id>/).
const cache = new Map();

async function get(path, type = 'json') {
  if (!cache.has(path)) {
    cache.set(path, fetch(path, { cache: 'no-cache' }).then(r => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return type === 'json' ? r.json() : r.text();
    }));
  }
  return cache.get(path);
}

export const loadRegistry = () => get('content/courses.json');
export const loadFigures = () => get('content/figures.json');

// Everything for one course, from its registry entry.
export function courseFiles(entry) {
  const dir = entry.path;
  const files = {
    course: () => get(`${dir}course.json`),
    glossary: () => get(`${dir}glossary.json`),
    lesson: id => get(`${dir}modules/${id}.md`, 'text'),
    quiz: id => get(`${dir}quizzes/${id}.json`).catch(() => null),
    // Quiz pools for every ready module, keyed by module number.
    async pools(course, upTo = 99, only = null) {
      const ids = course.items.filter(i => i.kind === 'module' && i.num <= upTo && course.ready.includes(i.id) && (!only || only.has(i.num)));
      const quizzes = await Promise.all(ids.map(i => files.quiz(i.id)));
      const pools = {};
      ids.forEach((item, k) => { if (quizzes[k]) pools[item.num] = quizzes[k].questions; });
      return pools;
    },
  };
  return files;
}
