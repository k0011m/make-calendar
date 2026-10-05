const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

// DOMに依存しない実際の関数を読み込み、共有データと日付の回帰を検出する。
function loadFunctions(names, extra = {}) {
  const context = vm.createContext({ structuredClone, Date, console, ...extra });
  for (const name of names) {
    const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?^}`, 'm'));
    assert.ok(match, name);
    vm.runInContext(match[0], context);
  }
  return context;
}
const names = ['getWeekOrder', 'getWeekStartDate', 'getDaysInMonth', 'getPositionedItems', 'formatDayTime', 'safeCalendarColor', 'getColorPreset', 'getPaperColor', 'getScheduleColor', 'getCalendarItemCollections', 'createExportFileName', 'exportCurrentCalendar', 'validateImportPayload', 'isValidItemCollection', 'sanitizeImportedCalendar', 'remapImportedAssets', 'importCalendarFile'];

test('Monthは未配置でも2枠を描画し、枠数を減らしても元データを削除しない', () => {
  const c = loadFunctions(['getPositionedItems', 'renderPlacedItems', 'escapeHtml'], {assetVisual:()=>'<img>'});
  const items = [{label:'予定',cellIndex:0},{label:'右側',cellIndex:1},{label:'旧3枠目',cellIndex:2}];
  assert.equal((c.renderPlacedItems([], 'month:1', 2).match(/<button/g)||[]).length, 2);
  const html = c.renderPlacedItems(items, 'month:1', 2);
  assert.equal((html.match(/<button/g)||[]).length, 2);
  assert.ok(html.includes('data-cell-index="1"'));
  assert.equal((c.renderPlacedItems(items, 'month:1', 1).match(/<button/g)||[]).length, 1);
  assert.equal(items.length, 3);
});

test('指定日を先頭とする7日間と月境界', () => {
  const c = loadFunctions(names);
  for (const date of ['2026-10-06', '2026-12-31', '2027-01-01']) {
    const calendar = { type: 'week', date };
    assert.equal(c.getWeekOrder(calendar)[0], new Date(`${date}T00:00:00`).getDay());
    assert.equal(c.getWeekOrder(calendar).length, 7);
    assert.equal(c.getWeekStartDate(calendar).getDate(), Number(date.slice(-2)));
  }
  assert.equal(c.getDaysInMonth('2026-02-01'), 28);
  assert.equal(c.getDaysInMonth('2028-02-01'), 29);
});
test('配置位置を保持し旧データの重複位置を補う', () => {
  const c = loadFunctions(names);
  assert.deepEqual(Array.from(c.getPositionedItems([{cellIndex:3},{cellIndex:4}]), x=>x.cellIndex), [3,4]);
  assert.deepEqual(Array.from(c.getPositionedItems([{},{}]), x=>x.cellIndex), [0,1]);
});
test('白・時間帯・曜日・個別色の優先順位', () => {
  const c = loadFunctions(names);
  assert.equal(c.getScheduleColor({type:'day',colorPreset:'white',scheduleColors:{a:'#123456'}},'a','07:00'), '#ffffff');
  assert.equal(c.getScheduleColor({type:'day',colorPreset:'auto'},'a','07:00'), '#fff0b3');
  assert.equal(c.getScheduleColor({type:'day',colorPreset:'auto',scheduleColors:{a:'#123456'}},'a','07:00'), '#123456');
  assert.equal(c.getScheduleColor({type:'week',colorPreset:'weekend'},'6'), '#b9d9ff');
  assert.equal(c.getScheduleColor({type:'month',colorPreset:'weekend'},'0'), '#ffc4c4');
  assert.equal(c.formatDayTime('01:00','kanji'), '1時');
  assert.equal(c.formatDayTime('13:30','hiragana'), '13じ30ふん');
});
test('一覧から削除した配置済み自作画像も共有に同梱する', () => {
  let exported;
  const asset = {id:'deleted',custom:true,label:'検証',icon:'data:image/png;base64,AA==',cellIndex:3};
  const calendar = {type:'day',title:'検証',slots:[{items:[asset]}]};
  const c = loadFunctions(names, {getActiveCalendar:()=>calendar,state:{customAssets:[]},saveTextDownload:text=>{exported=JSON.parse(text);},showToast:()=>{}});
  c.exportCurrentCalendar();
  assert.equal(exported.assets.length,1);
  assert.equal(exported.assets[0].icon,asset.icon);
});
test('Day共有読込は再発行した時間IDへ個別色と画像位置を復元する', async () => {
  let seq=0;
  const state={customAssets:[],calendars:[]};
  const noop=()=>{};
  const c=loadFunctions(names,{state,createId:p=>`${p}-${++seq}`,getTodayString:()=> '2026-10-05',normalizeCalendar:noop,persistState:()=>true,renderAssets:noop,renderLibraryAssets:noop,renderIllustrationGallery:noop,renderCards:noop,showToast:noop,standardAssetsById:new Map()});
  const payload={format:'make-illustration-calendar',version:1,calendar:{type:'day',date:'2026-10-06',colorPreset:'custom',scheduleColors:{old:'#123456'},slots:[{id:'old',time:'07:00',items:[{id:'custom',custom:true,cellIndex:4}]}]},assets:[{id:'custom',custom:true,label:'検証',icon:'data:image/png;base64,AA=='}]};
  assert.equal(await c.importCalendarFile({size:500,text:async()=>JSON.stringify(payload)}),true);
  const calendar=state.calendars[0];
  assert.equal(calendar.scheduleColors[calendar.slots[0].id],'#123456');
  assert.equal(calendar.slots[0].items[0].cellIndex,4);
  assert.equal(await c.importCalendarFile({size:500,text:async()=>'{broken'}),false);
  assert.equal(state.calendars.length,1);
});
test('無料シンボルの全画像ファイルが存在する', () => {
  const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/drops/catalog.json'),'utf8'));
  const assets=Array.isArray(catalog)?catalog:catalog.assets;
  assert.ok(assets.length>=1400);
  for(const asset of assets) assert.ok(fs.existsSync(path.join(__dirname,'..',asset.icon)),asset.icon);
});
test('複数画像は確定まで登録せず、確定後にまとめて登録する', async () => {
  const registered=[];
  const noop=()=>{};
  const button={disabled:false};
  const c=loadFunctions(['stageLibraryFiles','clearPendingLibraryFiles','confirmLibraryFiles'],{
    pendingLibraryFiles:[],URL:{createObjectURL:f=>`blob:${f.name}`,revokeObjectURL:noop},
    document:{querySelector:()=>button},renderPendingLibraryFiles:noop,showToast:noop,
    addUploadedFiles:async files=>{registered.push(...files);return files;},importCalendarFile:async()=>true,
    fileDialog:{close:noop},renderCards:noop,showView:noop
  });
  const files=[{name:'one.png',type:'image/png',size:1},{name:'two.png',type:'image/png',size:2}];
  c.stageLibraryFiles(files);
  c.stageLibraryFiles(files);
  assert.equal(c.pendingLibraryFiles.length,2);
  assert.equal(registered.length,0);
  await c.confirmLibraryFiles();
  assert.equal(registered.length,2);
  assert.equal(c.pendingLibraryFiles.length,0);
  assert.equal(button.disabled,false);
});
