import * as assert from 'node:assert/strict';
import { UsersService } from '../users.service';

// An export guards every formula-like cell with a leading apostrophe, whatever
// the separator of the language it is written in. Each case names the language
// it exercises: the default (English) and one other file shape (French).

function buildService() {
  const repo = {
    find: async () => [
      {
        email: 'safe@example.invalid',
        first_name: '=2+5',
        last_name: '@cmd',
        role: { role_name: '+Admin' },
        company: { name: '-Company' },
        department: { name: '\tDepartment' },
        status: 'enabled',
      },
    ],
  };

  return new UsersService(
    repo as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

async function englishDefault() {
  const service = buildService();

  const result = await service.exportCsv('data');
  // English: comma separator, every formula-like cell still guarded.
  assert.match(result.content, /,'=2\+5,/);
  assert.match(result.content, /,'@cmd,/);
  assert.match(result.content, /,'\+Admin,/);
  assert.match(result.content, /,'-Company,/);
  assert.match(result.content, /,'\tDepartment,/);
}

async function frenchFile() {
  const service = buildService();

  const result = await service.exportCsv('data', { language: 'fr' });
  // French: semicolon separator, the guard unchanged.
  assert.match(result.content, /;'=2\+5;/);
  assert.match(result.content, /;'@cmd;/);
  assert.match(result.content, /;'\+Admin;/);
  assert.match(result.content, /;'-Company;/);
  assert.match(result.content, /;'\tDepartment;/);
}

void englishDefault();
void frenchFile();
