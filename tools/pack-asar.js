'use strict';
/* 离线重打绿色版 app.asar。
 *
 * electron-builder 在完全离线时会卡在 winCodeSign 等工具下载上，因此提供一个只替换
 * resources/app.asar 的最小方案：保留已有的 ToDoLocal.exe（图标 / 版本信息已正确），
 * 用当前 src/ 重新打包运行时代码。
 *
 * 用法：
 *   node tools/pack-asar.js                        # 默认更新 electron/dist/ToDoLocal
 *   node tools/pack-asar.js --app release/win-unpacked
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RUNTIME_FILES = ['app.js', 'main.js', 'preload.js', 'xlsx.js', 'index.html', 'styles.css', 'icon.ico'];

function parseArgs(argv) {
  const out = { app: path.join(ROOT, 'electron', 'dist', 'ToDoLocal') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--app' && argv[i + 1]) { out.app = path.resolve(argv[++i]); }
  }
  return out;
}

function loadAsar() {
  const candidates = [
    path.join(ROOT, 'node_modules', '@electron', 'asar'),
    path.join(ROOT, 'electron', 'node_modules', '@electron', 'asar'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return require(dir);
  }
  throw new Error('找不到 @electron/asar，请先在 electron/ 或项目根目录安装依赖');
}

const rimraf = (p) => { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const resources = path.join(args.app, 'resources');
  const exe = path.join(args.app, 'ToDoLocal.exe');
  if (!fs.existsSync(resources)) throw new Error(`不是有效的绿色版目录（缺少 resources）：${args.app}`);
  if (!fs.existsSync(exe)) console.warn(`[警告] 未找到 ${exe}，仅更新 app.asar`);

  const asar = loadAsar();
  const version = require(path.join(ROOT, 'package.json')).version;
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'todolocal-asar-'));
  const outAsar = path.join(stage, 'app.asar');

  try {
    fs.mkdirSync(path.join(stage, 'app', 'src'), { recursive: true });
    for (const name of RUNTIME_FILES) {
      const from = path.join(ROOT, 'src', name);
      if (!fs.existsSync(from)) throw new Error('缺少源文件: ' + from);
      fs.copyFileSync(from, path.join(stage, 'app', 'src', name));
    }
    const pkg = {
      name: 'todo-local',
      version,
      description: 'Microsoft To Do style offline desktop task manager, strictly local with no network access',
      main: 'src/main.js',
      private: true,
      license: 'MIT',
      author: 'nsq4926',
    };
    fs.writeFileSync(path.join(stage, 'app', 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');

    await asar.createPackage(path.join(stage, 'app'), outAsar);

    // 结构自检
    const list = (await asar.listPackage(outAsar)).map((p) => p.replace(/^[\\/]/, '').replace(/\\/g, '/'));
    const packaged = JSON.parse((await asar.extractFile(outAsar, 'package.json')).toString('utf8'));
    if (packaged.main !== 'src/main.js') throw new Error('package.json main 不正确: ' + packaged.main);
    for (const name of RUNTIME_FILES) {
      if (!list.includes('src/' + name)) throw new Error('asar 缺少 src/' + name);
      const packed = await asar.extractFile(outAsar, 'src/' + name);
      if (!packed.equals(fs.readFileSync(path.join(ROOT, 'src', name)))) {
        throw new Error('asar 内 src/' + name + ' 与源文件不一致');
      }
    }

    const target = path.join(resources, 'app.asar');
    const identical = fs.existsSync(target) && fs.readFileSync(target).equals(fs.readFileSync(outAsar));
    let backup = null;
    if (!identical && fs.existsSync(target)) {
      let oldVersion = 'prev';
      try {
        const oldPkg = JSON.parse((await asar.extractFile(target, 'package.json')).toString('utf8'));
        if (oldPkg && oldPkg.version) oldVersion = oldPkg.version;
      } catch (_) { /* 旧包读不出就用 prev */ }
      backup = path.join(resources, `app.asar.${oldVersion}.bak`);
      if (!fs.existsSync(backup)) fs.copyFileSync(target, backup);
    }
    if (!identical) fs.copyFileSync(outAsar, target);

    const icon = path.join(ROOT, 'build', 'icon.ico');
    if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(resources, 'icon.ico'));

    console.log('app dir     :', args.app);
    console.log('entries     :', list.join(', '));
    console.log('version     :', packaged.version, 'main:', packaged.main);
    console.log('app.asar    :', fs.statSync(target).size, 'bytes');
    console.log('backup      :', backup ? `${backup} (${fs.statSync(backup).size} bytes)` : (identical ? '内容相同，未改动' : '（无旧版本）'));
    console.log('icon.ico    :', fs.existsSync(path.join(resources, 'icon.ico')) ? fs.statSync(path.join(resources, 'icon.ico')).size + ' bytes' : '未更新');
    console.log('\n完成。启动日志见 <软件目录>/ToDoLocal-Data/launch.log');
  } finally {
    rimraf(stage);
  }
}

main().catch((err) => {
  console.error('打包失败:', (err && err.stack) || err);
  process.exit(1);
});
