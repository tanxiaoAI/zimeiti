const fs = require('fs');
const file = 'apps/api/src/services/appStore.js';
let content = fs.readFileSync(file, 'utf8');

if (!content.includes('uuidv4')) {
    content = content.replace('import { db } from "../db.js";', 'import { db } from "../db.js";\nimport { v4 as uuidv4 } from "uuid";');
}

const newFunctions = `
export function addVideoTeardown(project_id, data) {
  const id = uuidv4();
  const stmt = db.prepare(\`
    INSERT INTO video_teardowns (id, project_id, url, title, content, date_published, cover_image, user_name, video_url, local_video_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  \`);
  stmt.run(id, project_id, data.url, data.title, data.content, data.date_published, data.cover_image, data.user_name, data.video_url, data.local_video_path);
  return getVideoTeardown(id);
}

export function getVideoTeardown(id) {
  return db.prepare('SELECT * FROM video_teardowns WHERE id = ?').get(id);
}

export function listVideoTeardowns(project_id) {
  return db.prepare('SELECT * FROM video_teardowns WHERE project_id = ? ORDER BY created_at DESC').all(project_id);
}

export function updateVideoTeardown(id, updates) {
  const fields = [];
  const values = [];
  for (const [k,Ùt½˜=‰©•Ğ¹•¹ÑÉ¥•Ì¡ÕÁ‘…Ñ•Ì¤¤ì(€€€™¥•±‘Ì¹ÁÕÍ ¡q€‘í­ô€ô€ıq€¤ì(€€€Ù…±Õ•Ì¹ÁÕÍ ¡Ø¤ì(€ô(€¥˜€¡™¥•±‘Ì¹±•¹Ñ €ôôô€À¤É•ÑÕÉ¸•ÑY¥‘•½Q•…É‘½İ¸¡¥¤ì(€Ù…±Õ•Ì¹ÁÕÍ ¡¥¤ì(€‘ˆ¹ÁÉ•Á…É”¡qUAQÙ¥‘•½}Ñ•…É‘½İ¹ÌMP€‘ì™¥•±‘Ì¹©½¥¸ œ°€œ¤ô]!I¥€ô€ıq€¤¹ÉÕ¸ ¸¸¹Ù…±Õ•Ì¤ì(€É•ÑÕÉ¸•ÑY¥‘•½Q•…É‘½İ¸¡¥¤ì)ô()•áÁ½ÉĞ™Õ¹Ñ¥½¸‘•±•Ñ•Y¥‘•½Q•…É‘½İ¸¡¥°ÁÉ½©•Ñ}¥¤ì(€½¹ÍĞÉ•Ì€ô‘ˆ¹ÁÉ•Á…É” 1QI=4Ù¥‘•½}Ñ•…É‘½İ¹Ì]!I¥€ô€ü9ÁÉ½©•Ñ}¥€ô€üœ¤¹ÉÕ¸¡¥°ÁÉ½©•Ñ}¥¤ì(€É•ÑÕÉ¸É•Ì¹¡…¹•Ì€ø€Àì)ô)€ì()½¹Ñ•¹Ğ€¬ô€q¹q¸œ€¬¹•İÕ¹Ñ¥½¹Ìì)™Ì¹İÉ¥Ñ•¥±•Må¹Œ¡™¥±”°½¹Ñ•¹Ğ¤ì)½¹Í½±”¹±½œ …ÁÁMÑ½É”Á…Ñ¡•ÍÕ•ÍÍ™Õ±±ä¸œ¤ì(