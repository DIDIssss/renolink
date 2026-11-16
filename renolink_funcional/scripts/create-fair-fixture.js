'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { validate } = require('../lib/data');
const { createFairFixture } = require('../test/fixtures/fair-synthetic');

async function writeFixture(output) {
  if (typeof output !== 'string' || !path.isAbsolute(output)) {
    throw Error('Caminho absoluto de fixture é obrigatório.');
  }
  const resolved = path.resolve(output);
  const parent = fs.realpathSync(path.dirname(resolved));
  const target = path.join(parent, path.basename(resolved));
  const root = path.resolve(__dirname, '..');
  if (target.toLowerCase().startsWith(root.toLowerCase() + path.sep)) {
    throw Error('Fixture deve ficar fora do projeto.');
  }
  if (!fs.statSync(parent).isDirectory()) {
    throw Error('Diretório de saída precisa existir.');
  }
  const db = validate(await createFairFixture());
  const fd = fs.openSync(target, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(db, null, 2));
    fs.fsyncSync(fd);
  } catch (error) {
    fs.closeSync(fd);
    fs.unlinkSync(target);
    throw error;
  }
  fs.closeSync(fd);
  return target;
}

async function main(args = process.argv.slice(2)) {
  try {
    if (args.length !== 2 || args[0] !== '--output') {
      throw Error('Informe --output com caminho absoluto fora do projeto.');
    }
    await writeFixture(args[1]);
    console.log('Fixture integralmente sintética criada; nenhum segredo foi registrado.');
  } catch {
    console.error('Criação da fixture recusada. Verifique caminho absoluto, diretório e ausência de arquivo existente.');
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { writeFixture, main };
