import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const definitions = JSON.parse(
  fs.readFileSync(path.join(root, '../proto/npc_definitions.json'), 'utf8'),
);

let out = 'export enum NpcId {\n';
for (const { name, id } of definitions) {
  out += `  ${name} = ${id},\n`;
}
out += '}\n';

fs.mkdirSync(path.join(root, 'generated'), { recursive: true });
fs.writeFileSync(path.join(root, 'generated/npc_id.ts'), out);
