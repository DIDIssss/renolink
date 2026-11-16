/* Restaura o banco JSON para os dados de demonstração. */
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
fs.copyFileSync(path.join(dataDir, 'db.seed.json'), path.join(dataDir, 'db.json'));
console.log('Banco RenoLink restaurado com sucesso.');
