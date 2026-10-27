import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTitle, fetchTitle, isPrivateAddress } from '../lib/link-title.mjs';

test('заголовок страницы: <title> с сущностями, затем og:title', () => {
  assert.equal(extractTitle('<head><title>\n  Код-ревью: cookbook &amp; практика / Хабр </title></head>'), 'Код-ревью: cookbook & практика / Хабр');
  assert.equal(extractTitle('<meta content="Статья &#171;X&#187;" property="og:title"><title></title>'), 'Статья «X»');
  assert.equal(extractTitle('<html></html>'), '');
});

test('локальные и не-http ссылки не запрашиваются', async () => {
  await assert.rejects(fetchTitle('http://localhost:7373/'), { status: 422 });
  await assert.rejects(fetchTitle('http://192.168.1.10/'), { status: 422 });
  await assert.rejects(fetchTitle('http://[::1]:7373/'), { status: 422 });
  await assert.rejects(fetchTitle('http://2130706433/'), { status: 422 });
  await assert.rejects(fetchTitle('http://100.64.0.1/'), { status: 422 });
  await assert.rejects(fetchTitle('file:///etc/passwd'), { status: 422 });
  await assert.rejects(fetchTitle('не ссылка'), { status: 422 });
});

test('внутренние адреса отличаются от публичных', () => {
  for (const ip of ['127.0.0.1', '10.2.3.4', '172.20.0.1', '192.168.0.5', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fd00::1', 'fe80::1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '178.248.237.68', '172.32.0.1', '2001:4860:4860::8888', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});
