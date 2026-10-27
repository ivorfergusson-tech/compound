// Loads the course data from content/. Everything is cached after the first fetch.
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

export const loadCourse = () => get('content/course.json');
export const loadFigures = () => get('content/figures.json');
export const loadGlossary = () => get('content/glossary.json');
export const loadLesson = id => get(`content/modules/${id}.md`, 'text');
export const loadQuiz = id => get(`content/quizzes/${id}.json`).catch(() => null);

// Quiz pools for every ready module, keyed by module number.
export async function loadPools(course, upTo = 99) {
  const ids = course.items.filter(i => i.kind === 'module' && i.num <= upTo && course.ready.includes(i.id));
  const quizzes = await Promise.all(ids.map(i => loadQuiz(i.id)));
  const pools = {};
  ids.forEach((item, k) => { if (quizzes[k]) pools[item.num] = quizzes[k].questions; });
  return pools;
}
