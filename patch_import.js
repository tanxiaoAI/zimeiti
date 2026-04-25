const fs = require('fs');
const file = '/Users/tanxiao/Desktop/trae/自媒体/apps/api/src/server.js';
let content = fs.readFileSync(file, 'utf8');

if (!content.includes('import { streamChatWithGemini, analyzeVideoWithGemini } from "./services/aiAgent.js";')) {
  content = content.replace(
    'import { streamChatWithGemini } from "./services/aiAgent.js";',
    'import { streamChatWithGemini, analyzeVideoWithGemini } from "./services/aiAgent.js";'
  );
  fs.writeFileSync(file, content);
  console.log('patched import');
}
