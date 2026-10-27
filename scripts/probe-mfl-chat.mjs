// TEMPORARY, posts nothing. Finds the URL shape of MFL's `chat_save` misc
// request: `import?TYPE=chat_save` answered "Invalid Data Type (chat_save)" on
// production. No cookie and no league id are sent, so no chat can be written.
const year = new Date().getFullYear();
const show = async (label, url) => {
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    console.log(`--- ${label}: ${res.status} ${res.headers.get('location') ?? ''}\n${text.slice(0, 400)}`);
    return text;
  } catch (e) {
    console.log(`--- ${label}: ${e}`);
    return '';
  }
};
const info = await show('api_info', `https://api.myfantasyleague.com/${year}/api_info?STATE=details`);
const plain = info.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
for (const key of ['chat_save', 'live_draft', 'Misc', 'Request URL', 'https://api.myfantasyleague.com/']) {
  let i = -1;
  let n = 0;
  while ((i = plain.indexOf(key, i + 1)) >= 0 && n++ < 4) console.log(`[${key}] …${plain.slice(Math.max(0, i - 200), i + 300)}…`);
}
await show('path, no params', `https://api.myfantasyleague.com/${year}/chat_save`);
await show('path, JSON', `https://api.myfantasyleague.com/${year}/chat_save?JSON=1`);
await show('import, no params', `https://api.myfantasyleague.com/${year}/import?TYPE=chat_save`);
