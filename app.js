// ===========================
// 报价管理系统 v4.0
// 三角色: 报价员(产品+报价) + 询价员(询价) + 管理员(物流+运费)
// 数据存储: 本地 JSON 文件（首次使用选择目录）
// ===========================

// === 1688 API Config ===
const TMAPI_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJVc2VybmFtZSI6IkRTQSIsIkNvbWlkIjpudWxsLCJSb2xlaWQiOm51bGwsImlzcyI6InRtYXBpIiwic3ViIjoiRFNBIiwiYXVkIjpbIiJdLCJpYXQiOjE3NDI5ODczNzB9.I2Ty0TtKYE_zHiuT071RjDgsM7x4UC7rePJD0c4qR9M';
const TMAPI_BASE = 'https://api.tmapi.top';

const STORAGE = { products: 'qms_products', logistics: 'qms_logistics', freight: 'qms_freight', quotes: 'qms_quotes', users: 'qms_users' };
const DIR_DB = 'qms_dir_db';
const DIR_STORE = 'qms_dir_store';
const DIR_HANDLE_KEY = 'qms_dir_handle';
const LOGIN_KEY = 'qms_login_user';
let DATA_DIR_HANDLE = null; // 文件目录句柄
let DATA_DIR_NAME = '';

const USER_ROLES = {
  admin: '管理员',
  quote: '报价员',
  inquiry: '询价员'
};
const DEFAULT_USER_SEEDS = [
  { username: 'admin', password: 'admin123', role: 'admin', name: '管理员' },
  { username: 'quote', password: 'quote123', role: 'quote', name: '报价员' },
  { username: 'inquiry', password: 'inquiry123', role: 'inquiry', name: '询价员' }
];
let CURRENT_USER = null;


function renderDataDirDisplay() {
  const el = document.getElementById('data-dir-display');
  if (!el) return;
  if (DATA_DIR_NAME) {
    el.textContent = DATA_DIR_NAME;
    el.title = DATA_DIR_NAME;
  } else if (DATA_DIR_HANDLE && DATA_DIR_HANDLE.name) {
    el.textContent = DATA_DIR_HANDLE.name;
    el.title = DATA_DIR_HANDLE.name;
  } else {
    el.textContent = '未设置 Not Set';
    el.title = '';
  }
}

function openDirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DIR_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DIR_STORE)) db.createObjectStore(DIR_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeDirHandle(handle) {
  try {
    const db = await openDirDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DIR_STORE, 'readwrite');
      tx.objectStore(DIR_STORE).put(handle, DIR_HANDLE_KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('[storeDirHandle] failed', e);
  }
}

async function loadDirHandle() {
  try {
    const db = await openDirDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DIR_STORE, 'readonly');
      const req = tx.objectStore(DIR_STORE).get(DIR_HANDLE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('[loadDirHandle] failed', e);
    return null;
  }
}

async function restoreDataDirectory() {
  if (!('showDirectoryPicker' in window)) return;
  if (DATA_DIR_HANDLE) return;
  const handle = await loadDirHandle();
  if (!handle) return;
  let perm = await handle.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted') {
    perm = await handle.requestPermission({ mode: 'readwrite' });
  }
  if (perm === 'granted') {
    DATA_DIR_HANDLE = handle;
    DATA_DIR_NAME = handle?.name || '';
  }
}

// 文件名映射
const FILE_NAMES = {
  products: 'products.json',
  logistics: 'logistics.json',
  freight: 'freight.json',
  quotes: 'quotes.json',
  users: 'users.json'
};

// 从文件加载数据
async function load(k) {
  try {
    let data = [];

    // 如果没有目录句柄，尝试从 localStorage 读取（首次使用或降级）
    if (!DATA_DIR_HANDLE) {
      const stored = localStorage.getItem(STORAGE[k]);
      data = stored ? JSON.parse(stored) : [];
    } else {
      // 从文件读取
      const file = await DATA_DIR_HANDLE.getFileHandle(FILE_NAMES[k], { create: true });
      const fileData = await file.getFile();
      const text = await fileData.text();
      data = text ? JSON.parse(text) : [];
    }

    if (k === 'products') {
      const { items, changed } = normalizeProducts(data);
      if (changed) await save('products', items);
      return items;
    }

    if (k === 'users') {
      const { items, changed } = await normalizeUsers(data);
      if (changed) await save('users', items);
      return items;
    }

    return data;
  } catch (e) {
    console.error(`[load] ${k} error:`, e);
    return [];
  }
}

// 保存数据到文件
async function save(k, v) {
  try {
    // 如果没有目录句柄，保存到 localStorage（首次使用或降级）
    if (!DATA_DIR_HANDLE) {
      localStorage.setItem(STORAGE[k], JSON.stringify(v));
      return;
    }

    // 写入文件
    const file = await DATA_DIR_HANDLE.getFileHandle(FILE_NAMES[k], { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(v, null, 2));
    await writable.close();
    console.log(`[save] ${k} saved to file`);
  } catch (e) {
    console.error(`[save] ${k} error:`, e);
    toast('保存失败，请检查文件访问权限 Save failed, check file access permissions', 'err');
  }
}

function extractUrl(text) {
  if (!text || typeof text !== 'string') return '';
  const match = text.match(/https?:\/\/[^\s'"<>]+/i);
  return match ? match[0] : '';
}

function getProductRefLink(p) {
  if (!p) return '';
  return p.productLink || p.referenceLink || p.refLink || p.productRefLink || p['产品参考链接'] || p['产品链接'] || p['商品链接'] || p.link || p.url || extractUrl(p.note) || extractUrl(p.spec) || '';
}

function normalizeProducts(list) {
  if (!Array.isArray(list)) return { items: [], changed: false };
  let changed = false;
  const items = list.map(p => {
    const item = { ...p };
    if (!item.id) { item.id = gid(); changed = true; }
    if (!item.name) { item.name = item.productName || item.code || '未命名产品'; changed = true; }
    if (!item.sku && item.code) { item.sku = item.code; changed = true; }
    if (!item.category) { item.category = '其他'; changed = true; }
    if (!item.status) { item.status = 'pending'; changed = true; }
    if (!item.createdAt) { item.createdAt = new Date().toISOString(); changed = true; }
    if (!item.opDate) {
      item.opDate = fmtD(item.updatedAt || item.createdAt || new Date().toISOString());
      changed = true;
    }
    if (!item.quoteUserName) {
      item.quoteUserName = item.quoteUser || item.quoteBy || item.opUser || item.operator || item.updatedBy || item.createdBy || '';
      changed = true;
    }
    if (!item.inquiryUserName) {
      item.inquiryUserName = item.inquiryUser || item.inquiredBy || '';
      changed = true;
    }
    if (!item.opUser && item.quoteUserName) {
      item.opUser = item.quoteUserName;
      changed = true;
    }
    if (item.cost == null && item.unitPrice != null) { item.cost = item.unitPrice; changed = true; }
    if (item.weight == null && item.calcWeight != null) { item.weight = item.calcWeight; changed = true; }
    if (item.weight == null && item.unitWeight != null) { item.weight = item.unitWeight; changed = true; }
    if (!item.productLink) {
      const link = getProductRefLink(item);
      if (link) { item.productLink = link; changed = true; }
    }
    if (!item.productLink && item.status === 'pending' && item.purchaseLink1) {
      item.productLink = item.purchaseLink1;
      changed = true;
    }
    return item;
  });
  return { items, changed };
}

function gid() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 5) }
function today() { return new Date().toISOString().slice(0, 10) }
function fmtD(iso) { return iso ? iso.slice(0, 10) : '--' }
function fmtDT(iso) { return iso ? iso.slice(0, 16).replace('T', ' ') : '--' }
function roleLabel(role) { return USER_ROLES[role] || role || '-' }

async function hashPassword(password) {
  const text = String(password || '');
  if (!text) return '';
  if (window.crypto && window.crypto.subtle) {
    const bytes = new TextEncoder().encode(text);
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return text;
}

async function buildDefaultUsers() {
  const now = new Date().toISOString();
  const users = [];
  for (const seed of DEFAULT_USER_SEEDS) {
    users.push({
      id: gid(),
      username: seed.username,
      name: seed.name,
      role: seed.role,
      passwordHash: await hashPassword(seed.password),
      createdAt: now
    });
  }
  return users;
}

async function normalizeUsers(list) {
  if (!Array.isArray(list)) return { items: [], changed: false };
  let changed = false;
  const items = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const item = { ...raw };
    if (!item.id) { item.id = gid(); changed = true; }
    if (!item.username) continue;
    if (!item.name) { item.name = item.username; changed = true; }
    if (!item.role || !USER_ROLES[item.role]) { item.role = 'quote'; changed = true; }
    if (!item.createdAt) { item.createdAt = new Date().toISOString(); changed = true; }
    if (!item.passwordHash && item.password) {
      item.passwordHash = await hashPassword(item.password);
      delete item.password;
      changed = true;
    }
    if (!item.passwordHash) continue;
    delete item.password;
    items.push(item);
  }
  return { items, changed };
}

async function ensureUsersSeeded() {
  const users = await load('users');
  if (users.length > 0) return users;
  const defaults = await buildDefaultUsers();
  await save('users', defaults);
  return defaults;
}

function isAdmin() {
  return CURRENT_USER && CURRENT_USER.role === 'admin';
}

function syncCurrentUser(user) {
  if (!user) return;
  const sessionUser = { id: user.id, username: user.username, name: user.name, role: user.role };
  CURRENT_USER = sessionUser;
  localStorage.setItem(LOGIN_KEY, JSON.stringify(sessionUser));
}

function applyUserPermissions() {
  const isAdminUser = isAdmin();
  document.querySelectorAll('[data-admin-only="true"]').forEach(el => {
    el.style.display = isAdminUser ? '' : 'none';
  });
}

// 默认国家列表（从 localStorage 加载，没有则用默认）
const DEFAULT_COUNTRIES = [
  { name: '美国', code: 'US' },
  { name: '英国', code: 'UK/GB' },
  { name: '法国', code: 'FR' },
  { name: '奥地利', code: 'AT' },
  { name: '意大利', code: 'IT' },
  { name: '西班牙', code: 'ES' },
  { name: '比利时', code: 'BE' },
  { name: '瑞士', code: 'CH' },
  { name: '卢森堡', code: 'LU' },
  { name: '爱尔兰', code: 'IE' },
  { name: '保加利亚', code: 'BG' },
  { name: '克罗地亚', code: 'CRO' },
  { name: '捷克', code: 'CZ' },
  { name: '爱沙尼亚', code: 'EE' },
  { name: '芬兰', code: 'FI' },
  { name: '匈牙利', code: 'HU' },
  { name: '拉脱维亚', code: 'LV' },
  { name: '立陶宛', code: 'LT' },
  { name: '波兰', code: 'PL' },
  { name: '葡萄牙', code: 'PT' },
  { name: '罗马尼亚', code: 'RO' },
  { name: '斯洛伐克', code: 'SK' },
  { name: '斯洛文尼亚', code: 'SI' },
  { name: '瑞典', code: 'SE/SW' },
  { name: '德国', code: 'DE' },
  { name: '丹麦', code: 'DK' },
  { name: '希腊', code: 'GR' },
  { name: '加拿大', code: 'CA' },
  { name: '挪威', code: 'NO' },
  { name: '以色列', code: 'IL' },
  { name: '新西兰', code: 'NZ' },
  { name: '阿拉伯联合酋长国', code: 'UAE' },
  { name: '泰国', code: 'THA' },
  { name: '日本', code: 'JP' },
  { name: '荷兰', code: 'NL' },
  { name: '墨西哥', code: 'MX' },
  { name: '沙特阿拉伯', code: 'SA' },
  { name: '科威特', code: 'KW' },
  { name: '卡塔尔', code: 'QA' },
  { name: '巴林', code: 'BH' },
  { name: '新加坡', code: 'SG' },
  { name: '澳大利亚', code: 'AU' },
  { name: '塞浦路斯', code: 'CY' },
  { name: '格鲁吉亚', code: 'GE' },
  { name: '阿曼苏丹国', code: 'OM/QA' },
  { name: '莫桑比克', code: 'MZ' },
  { name: '法罗群岛', code: 'FO' },
  { name: '毛里求斯', code: 'MU' },
  { name: '斯里兰卡', code: 'LK' },
  { name: '秘鲁', code: 'PE' },
  { name: '缅甸', code: 'MM' },
  { name: '索马里', code: 'SO' },
  { name: '摩洛哥', code: 'MA' },
  { name: '哥斯达黎加', code: 'CR' },
  { name: '菲律宾', code: 'PH' },
  { name: '马来西亚', code: 'MY' },
  { name: '巴基斯坦', code: 'PK' },
  { name: '南非', code: 'ZA' },
  { name: '伯利兹', code: 'BZ' },
  { name: '马耳他', code: 'MAL' },
  { name: '约旦', code: 'JO' },
  { name: '黎巴嫩', code: 'IB' },
  { name: '土耳其', code: 'TR' },
  { name: '巴西', code: 'BR' },
  { name: '韩国', code: 'KR' },
  { name: '尼日利亚', code: 'NG' },
  { name: '加纳', code: 'GHA' },
  { name: '乌干达', code: 'UGA' },
  { name: '肯尼亚', code: 'KE' },
  { name: '坦桑尼亚', code: 'TZ' },
  { name: '卢旺达', code: 'RWA' },
  { name: '安哥拉', code: 'AN' },
  { name: '埃及', code: 'EG' },
  { name: '越南', code: 'VN' },
  { name: '智利', code: 'CL' },
  { name: '哥伦比亚', code: 'CO' },
  { name: '中国台湾', code: 'TW' },
  { name: '中国香港', code: 'HK' },
  { name: '印度', code: 'IN' },
  { name: '乌克兰', code: 'UA' },
  { name: '波多黎各', code: 'PR' },
  { name: '阿曼', code: 'OM/QA' },
  { name: '阿联酋', code: 'UAE' },
  { name: '哈萨克斯坦', code: 'KZ' },
  { name: '印度尼西亚', code: 'ID' },
  { name: '阿尔巴尼亚', code: 'AL' },
  { name: '阿尔及利亚', code: 'DZ' },
  { name: '阿根廷', code: 'AR' },
  { name: '阿塞拜疆', code: 'AZ' },
  { name: '巴哈马', code: 'BS' },
  { name: '孟加拉国', code: 'BD' },
  { name: '不丹', code: 'BT' },
  { name: '博茨瓦纳', code: 'BW' },
  { name: '文莱', code: 'BN' },
  { name: '布隆迪', code: 'BI' },
  { name: '柬埔寨', code: 'KH' },
  { name: '科特迪瓦', code: 'CI' },
  { name: '厄瓜多尔', code: 'EC' },
  { name: '萨尔瓦多', code: 'SV' },
  { name: '埃塞俄比亚', code: 'ET' },
  { name: '格林纳达', code: 'GD' },
  { name: '危地马拉', code: 'GT' },
  { name: '几内亚', code: 'GN' },
  { name: '海地', code: 'HT' },
  { name: '冰岛', code: 'IS' },
  { name: '伊朗', code: 'IR' },
  { name: '伊拉克', code: 'IQ' },
  { name: '吉尔吉斯斯坦', code: 'KG' },
  { name: '老挝', code: 'LA' },
  { name: '马达加斯加', code: 'MG' },
  { name: '马尔代夫', code: 'MV' },
  { name: '马里', code: 'ML' },
  { name: '毛里塔尼亚', code: 'MR' },
  { name: '摩尔多瓦', code: 'MD' },
  { name: '蒙古', code: 'MN' },
  { name: '尼泊尔', code: 'NP' },
  { name: '尼日尔', code: 'NE' },
  { name: '巴拿马', code: 'PA' },
  { name: '圣卢西亚', code: 'LC' },
  { name: '圣文森特和格林纳丁斯', code: 'VC' },
  { name: '美属萨摩亚', code: 'AS' },
  { name: '塞内加尔', code: 'SN' },
  { name: '塞尔维亚', code: 'RS' },
  { name: '塔吉克斯坦', code: 'TJ' },
  { name: '汤加', code: 'TO' },
  { name: '突尼斯', code: 'TN' },
  { name: '土库曼斯坦', code: 'TM' },
  { name: '特克斯和凯科斯群岛', code: 'TC' },
  { name: '图瓦卢', code: 'TV' },
  { name: '乌拉圭', code: 'UY' },
  { name: '乌兹别克斯坦', code: 'UZ' },
  { name: '赞比亚', code: 'ZM' },
  { name: '津巴布韦', code: 'ZW' },
  { name: '留尼汪', code: 'RE' },
  { name: '安提瓜和巴布达', code: 'AG' },
  { name: '安圭拉', code: 'AI' },
  { name: '波黑', code: 'BA' },
  { name: '库拉索岛', code: 'CW' },
  { name: '厄立特里亚', code: 'ER' },
  { name: '法属圭亚那', code: 'GF' },
  { name: '冈比亚', code: 'GM' },
  { name: '几内亚比绍', code: 'GW' },
  { name: '圭亚那', code: 'GY' },
  { name: '泽西岛', code: 'JE' },
  { name: '科摩罗', code: 'KM' },
  { name: '黑山', code: 'ME' },
  { name: '马其顿', code: 'MK' },
  { name: '马拉维', code: 'MW' },
  { name: '巴布亚新几内亚', code: 'PG' },
  { name: '南苏丹', code: 'SS' },
  { name: '阿鲁巴', code: 'AW' },
  { name: '布基纳法索', code: 'BF' },
  { name: '贝宁', code: 'BJ' },
  { name: '刚果（金）', code: 'CD' },
  { name: '刚果（布）', code: 'CG' },
  { name: '库克群岛', code: 'CK' },
  { name: '喀麦隆', code: 'CM' },
  { name: '古巴', code: 'CU' },
  { name: '吉布提', code: 'DJ' },
  { name: '多米尼克', code: 'DM' },
  { name: '加蓬', code: 'GA' },
  { name: '直布罗陀', code: 'GI' },
  { name: '格陵兰', code: 'GL' },
  { name: '赤道几内亚', code: 'GQ' },
  { name: '马恩岛', code: 'IM' },
  { name: '基里巴斯', code: 'KI' },
  { name: '圣基茨和尼维斯', code: 'KN' },
  { name: '纳米比亚', code: 'NA' },
  { name: '瑙鲁', code: 'NR' },
  { name: '法属波利尼西亚', code: 'PF' },
  { name: '塞舌尔', code: 'SC' },
  { name: '苏丹', code: 'SD' },
  { name: '塞拉利昂', code: 'SL' },
  { name: '苏里南', code: 'SR' },
  { name: '圣多美和普林西比', code: 'ST' },
  { name: '乍得', code: 'TD' },
  { name: '多哥', code: 'TG' },
  { name: '东帝汶', code: 'TL' },
  { name: '萨摩亚', code: 'WS' },
  { name: '阿富汗', code: 'AF' },
  { name: '亚美尼亚', code: 'AM' },
  { name: '巴巴多斯', code: 'BB' },
  { name: '白俄罗斯', code: 'BY' },
  { name: '百慕大', code: 'BM' },
  { name: '玻利维亚', code: 'BO' },
  { name: '佛得角', code: 'CV' },
  { name: '荷兰加勒比区', code: 'BQ' },
  { name: '开曼群岛', code: 'KY' },
  { name: '中非', code: 'CF' },
  { name: '朝鲜', code: 'KP' },
  { name: '多米尼加共和国', code: 'DO' },
  { name: '福克兰群岛', code: 'FK' },
  { name: '洪都拉斯', code: 'HN' },
  { name: '牙买加', code: 'JM' },
  { name: '莱索托', code: 'LS' },
  { name: '利比里亚', code: 'LR' },
  { name: '列支敦士登', code: 'LI' },
  { name: '摩纳哥', code: 'MC' },
  { name: '新喀里多尼亚', code: 'NC' },
  { name: '尼加拉瓜', code: 'NI' },
  { name: '巴勒斯坦', code: 'PS' },
  { name: '巴拉圭', code: 'PY' },
  { name: '圣马力诺', code: 'SM' },
  { name: '圣马丁', code: 'MF' },
  { name: '利比亚', code: 'LY' },
  { name: '托克劳', code: 'TK' },
  { name: '特立尼达和多巴哥', code: 'TT' },
  { name: '瓦努阿图', code: 'VU' },
  { name: '委内瑞拉', code: 'VE' },
  { name: '瓦利斯和富图纳', code: 'WF' },
  { name: '安道尔', code: 'AD' },
  { name: '北马里亚纳群岛', code: 'MP' },
  { name: '马绍尔群岛', code: 'MH' },
  { name: '马提尼克', code: 'MQ' },
  { name: '圣皮埃尔和密克隆', code: 'PM' },
  { name: '美属维尔京群岛', code: 'VI' },
  { name: '格恩西岛', code: 'GG' },
  { name: '俄罗斯', code: 'RU' },
  { name: '马约特', code: 'MYT' }
];

function normalizeCountryItem(item) {
  if (!item) return null;
  const name = (item.name || '').trim();
  const code = (item.code || '').trim().toUpperCase();
  if (!name || !code) return null;
  return { name, code };
}

function mergeCountries(list, defaults) {
  const merged = [];
  const seen = new Set();
  const push = (item) => {
    const normalized = normalizeCountryItem(item);
    if (!normalized) return;
    const key = `${normalized.name}__${normalized.code}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(normalized);
  };
  (Array.isArray(list) ? list : []).forEach(push);
  defaults.forEach(push);
  return merged;
}

function loadCountries() {
  const stored = localStorage.getItem('qms_countries');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      const merged = mergeCountries(parsed, DEFAULT_COUNTRIES);
      if (merged.length) {
        const next = JSON.stringify(merged);
        if (next !== stored) localStorage.setItem('qms_countries', next);
        return merged;
      }
    } catch (e) {
      console.warn('[loadCountries] invalid stored data, fallback to defaults', e);
    }
  }
  return DEFAULT_COUNTRIES.slice();
}
function saveCountries(list) { localStorage.setItem('qms_countries', JSON.stringify(list)); }
function getCountryCode(name) { const c = loadCountries().find(x => x.name === name); return c ? c.code : name; }
function getCountryName(code) {
  const countries = loadCountries();
  const text = (code || '').toString().trim();
  if (!text) return code;
  const upper = text.toUpperCase();
  const exact = countries.find(x => x.code === text || x.code === upper);
  if (exact) return exact.name;
  const alias = countries.find(x => splitCountryCodes(x.code).includes(upper));
  return alias ? alias.name : text;
}

function splitCountryCodes(code) {
  if (!code) return [];
  return String(code).toUpperCase().split('/').map(s => s.trim()).filter(Boolean);
}

function buildCountryMatchSet(country) {
  const set = new Set();
  if (!country) return set;
  if (country.name) set.add(country.name);
  if (country.code) {
    set.add(country.code);
    splitCountryCodes(country.code).forEach(c => set.add(c));
  }
  return set;
}

function countryMatchesFreight(country, freightCountry) {
  if (!country || !freightCountry) return false;
  const text = String(freightCountry).trim();
  if (!text) return false;
  const matchSet = buildCountryMatchSet(country);
  if (matchSet.has(text)) return true;
  const freightCodes = splitCountryCodes(text);
  return freightCodes.some(c => matchSet.has(c));
}



// Toast
function toast(msg, type = 'ok') {
  const c = document.getElementById('toast-wrap');
  const icons = {
    ok: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
    err: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    info: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
  };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `${icons[type] || icons.info}<span style="flex:1;">${msg}</span><button class="modal-close" onclick="this.parentElement.remove()" style="position:static;">&times;</button>`;
  c.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(110%)'; el.style.transition = 'all .3s'; setTimeout(() => el.remove(), 300) }, 3500);
}

// Modal
function openM(id) { document.getElementById(id).classList.add('open') }
function closeM(id) { document.getElementById(id).classList.remove('open') }

// Navigation
let curPage = 'dashboard';
async function nav(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pe = document.getElementById('page-' + page); if (pe) pe.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => { if (n.getAttribute('onclick')?.includes(`'${page}'`)) n.classList.add('active') });
  curPage = page;
  switch (page) {
    case 'dashboard': await renderDash(); break;
    case 'products': await initProductFilters(); await renderProducts(); break;
    case 'inquiry': await renderInquiry(); break;
    case 'quote-gen': await initQuoteGen(); break;
    case 'quotes': await renderQuotes(); break;
    case 'logistics': await renderLogistics(); break;
    case 'freight': initFreightEvents(); await renderFreight(); break;
    case 'users': await renderUsers(); break;
  }
}

// ===========================
// Dashboard
// ===========================
async function renderDash() {
  const products = await load('products'), logistics = await load('logistics'), quotes = await load('quotes');
  document.getElementById('s-products').textContent = products.length;
  document.getElementById('s-pending').textContent = products.filter(p => p.status === 'pending').length;
  document.getElementById('s-quotes').textContent = quotes.length;
  document.getElementById('s-logistics').textContent = logistics.length;
  const now = new Date();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayNamesCN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  document.getElementById('today-str').textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${dayNamesCN[now.getDay()]} · ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ${dayNames[now.getDay()]}`;

  const rp = [...products].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
  const pc = document.getElementById('dash-products');
  pc.innerHTML = rp.length ? `<table style="width:100%;font-size:12.5px;"><thead><tr><th style="padding:8px;background:var(--gray-50);border-bottom:1px solid var(--gray-200);color:var(--gray-600);font-size:11px;">产品 Product</th><th style="padding:8px;background:var(--gray-50);border-bottom:1px solid var(--gray-200);color:var(--gray-600);font-size:11px;">状态 Status</th><th style="padding:8px;background:var(--gray-50);border-bottom:1px solid var(--gray-200);color:var(--gray-600);font-size:11px;">日期 Date</th></tr></thead><tbody>${rp.map(p => `<tr style="border-bottom:1px solid var(--gray-100);"><td style="padding:8px;">${p.name}</td><td style="padding:8px;">${stBadge(p.status)}</td><td style="padding:8px;color:var(--gray-500);">${fmtD(p.createdAt)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state" style="padding:24px;"><p>暂无产品 No Products</p></div>';

  const rq = [...quotes].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
  const qc = document.getElementById('dash-quotes');
  qc.innerHTML = rq.length ? `<table style="width:100%;font-size:12.5px;"><thead><tr><th style="padding:8px;background:var(--gray-50);border-bottom:1px solid var(--gray-200);color:var(--gray-600);font-size:11px;">产品 Product</th><th style="padding:8px;background:var(--gray-50);border-bottom:1px solid var(--gray-200);color:var(--gray-600);font-size:11px;">物流商 Logistics</th><th style="padding:8px;background:var(--gray-50);border-bottom:1px solid var(--gray-200);color:var(--gray-600);font-size:11px;">报价 Quote</th></tr></thead><tbody>${rq.map(q => `<tr style="border-bottom:1px solid var(--gray-100);"><td style="padding:8px;">${q.productName}</td><td style="padding:8px;">${q.logisticsName}</td><td style="padding:8px;font-weight:600;color:var(--primary);">$${q.avgPriceUSD}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state" style="padding:24px;"><p>暂无报价 No Quotes</p></div>';
}
function stBadge(s) {
  const m = { pending: '<span class="badge badge-yellow">待询价 Unsourced</span>', inquired: '<span class="badge badge-blue">已询价 Sourced</span>', quoted: '<span class="badge badge-green">已报价 Quoted</span>' };
  return m[s] || `<span class="badge badge-gray">${s}</span>`;
}

// ===========================
// Products (报价员)
// ===========================
let batchProductImportData = [];

async function getAssignableUsers(role) {
  const users = await ensureUsersSeeded();
  if (role === 'quote') return users.filter(u => u.role === 'quote' || u.role === 'admin');
  if (role === 'inquiry') return users.filter(u => u.role === 'inquiry' || u.role === 'admin');
  return users;
}

async function fillProductUserSelects(defaultQuoteName = '', defaultInquiryName = '') {
  const quoteSel = document.getElementById('p-quote-user');
  const inquirySel = document.getElementById('p-inquiry-user');
  if (!quoteSel || !inquirySel) return;

  const quoteUsers = await getAssignableUsers('quote');
  const inquiryUsers = await getAssignableUsers('inquiry');

  quoteSel.innerHTML = '<option value="">-- 请选择报价员 Select Quoter --</option>' + quoteUsers.map(u => {
    const name = u.name || u.username;
    return `<option value="${name}">${name}</option>`;
  }).join('');

  inquirySel.innerHTML = '<option value="">-- 请选择询价员 Select Sourcer --</option>' + inquiryUsers.map(u => {
    const name = u.name || u.username;
    return `<option value="${name}">${name}</option>`;
  }).join('');

  const ensureOption = (sel, val) => {
    if (!val) return;
    const exists = Array.from(sel.options).some(opt => opt.value === val);
    if (!exists) {
      sel.innerHTML += `<option value="${val}">${val}</option>`;
    }
  };

  ensureOption(quoteSel, defaultQuoteName);
  ensureOption(inquirySel, defaultInquiryName);

  quoteSel.value = defaultQuoteName || '';
  inquirySel.value = defaultInquiryName || '';
}

async function initProductFilters() {
  const products = await load('products');
  const quoteSel = document.getElementById('prod-quote-user');
  const inquirySel = document.getElementById('prod-inquiry-user');
  if (!quoteSel || !inquirySel) return;

  // 获取所有报价员和询价员
  const quoteUsers = [...new Set(products.map(p => p.quoteUserName).filter(Boolean))];
  const inquiryUsers = [...new Set(products.map(p => p.inquiryUserName).filter(Boolean))];

  quoteSel.innerHTML = '<option value="">全部报价员 All Quoters</option>' + quoteUsers.map(u => `<option value="${u}">${u}</option>`).join('');
  inquirySel.innerHTML = '<option value="">全部询价员 All Sourcers</option>' + inquiryUsers.map(u => `<option value="${u}">${u}</option>`).join('');
}

async function renderProducts() {
  const products = await load('products');
  const search = document.getElementById('prod-search').value.toLowerCase();
  const status = document.getElementById('prod-status').value;
  const dateStart = document.getElementById('prod-date-start').value;
  const dateEnd = document.getElementById('prod-date-end').value;
  const quoteUser = document.getElementById('prod-quote-user').value;
  const inquiryUser = document.getElementById('prod-inquiry-user').value;
  let filtered = products.filter(p => {
    const mSearch = !search || [p.name, p.sku, p.quoteUserName, p.inquiryUserName, p.opDate].some(v => (v || '').toString().toLowerCase().includes(search));
    const mStatus = !status || p.status === status;
    const pDate = p.opDate || '';
    const mDateStart = !dateStart || pDate >= dateStart;
    const mDateEnd = !dateEnd || pDate <= dateEnd;
    const mQuoteUser = !quoteUser || p.quoteUserName === quoteUser;
    const mInquiryUser = !inquiryUser || p.inquiryUserName === inquiryUser;
    return mSearch && mStatus && mDateStart && mDateEnd && mQuoteUser && mInquiryUser;
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const grid = document.getElementById('prod-grid'), empty = document.getElementById('prod-empty');
  if (filtered.length === 0) { grid.innerHTML = ''; empty.style.display = 'block'; return }
  empty.style.display = 'none';
  const idEsc = (id) => JSON.stringify(id).slice(1, -1);
  grid.innerHTML = filtered.map(p => {
    const imgSrc = p.realImage || p.image;
    const img = imgSrc
      ? `<div style="position:relative;"><img src="${imgSrc}" class="prod-card-img" alt="" onclick="event.stopPropagation();openProductImgUpload('${idEsc(p.id)}')" style="cursor:pointer;">
        ${p.realImage ? '<span style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.55);color:white;font-size:10px;padding:2px 6px;border-radius:4px;">实拍</span>' : ''}
        <span style="position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,0.55);color:white;font-size:10px;padding:2px 6px;border-radius:4px;">点击更换</span></div>`
      : `<div class="prod-card-img-ph" onclick="event.stopPropagation();openProductImgUpload('${idEsc(p.id)}')" style="cursor:pointer;"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--gray-300)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>`;
    const inquiryLabel = p.status === 'pending' ? '去询价 Source' : '修改询价 Edit';
    return `<div class="prod-card" onclick="event.target.closest('.prod-card-checkbox') ? event.stopPropagation() : openInquiryModal('${idEsc(p.id)}')">
      <label class="prod-card-checkbox" style="position:absolute;top:8px;left:8px;z-index:10;">
        <input type="checkbox" value="${p.id}" onchange="onProductCheckChange()">
      </label>
      ${img}
      <div class="prod-card-body"><div class="prod-card-name">${p.name}</div><div class="prod-card-meta">${p.sku || '无SKU No SKU'} · ${p.status === 'pending' ? '待询价 Unsourced' : p.status === 'inquired' ? '已询价 Sourced' : '已报价 Quoted'}</div><div class="prod-card-meta">日期 Date: ${p.opDate || '--'}</div><div class="prod-card-meta">报价员 Quoter: ${p.quoteUserName || '-'} · 询价员 Sourcer: ${p.inquiryUserName || '-'}</div></div>
      <div class="prod-card-footer"><button class="btn btn-sm btn-primary" onclick="event.stopPropagation();${p.status === 'pending' ? `open1688Search('${idEsc(p.id)}')` : `openInquiryModal('${idEsc(p.id)}')`}">${inquiryLabel}</button><button class="btn btn-sm btn-outline" onclick="event.stopPropagation();openInquiryHistory('${idEsc(p.id)}')">询价记录 History</button><button class="btn btn-sm btn-outline" onclick="event.stopPropagation();editProduct('${idEsc(p.id)}')">编辑 Edit</button><button class="btn btn-sm btn-danger" onclick="event.stopPropagation();delProduct('${idEsc(p.id)}')">删除 Del</button></div>
    </div>`;

  }).join('');
}

function onProductCheckChange() {
  const checkboxes = document.querySelectorAll('#prod-grid input[type="checkbox"]:checked');
  const count = checkboxes.length;
  const delBtn = document.getElementById('prod-batch-del-btn');
  const countSpan = document.getElementById('prod-selected-count');
  if (delBtn) delBtn.disabled = count === 0;
  if (countSpan) countSpan.textContent = `已选 ${count} 项 ${count} selected`;
}

function toggleAllProducts(cb) {
  const checked = cb.checked;
  document.querySelectorAll('#prod-grid input[type="checkbox"]').forEach(el => {
    el.checked = checked;
  });
  onProductCheckChange();
}

async function batchDelProducts() {
  const checkboxes = document.querySelectorAll('#prod-grid input[type="checkbox"]:checked');
  const ids = Array.from(checkboxes).map(cb => cb.value);
  if (ids.length === 0) return;
  if (!confirm(`确认删除选中的 ${ids.length} 个产品？\nDelete ${ids.length} selected products?`)) return;

  const products = await load('products');
  const remaining = products.filter(p => !ids.includes(p.id));
  await save('products', remaining);

  // 重置全选框
  document.getElementById('prod-chk-all').checked = false;
  onProductCheckChange();

  renderProducts();
  await renderDash();
  toast(`已删除 ${ids.length} 个产品`);
}

async function openAddProduct() {
  document.getElementById('mo-prod-title').textContent = '添加产品 Add Product';
  document.getElementById('ep-id').value = '';
  document.getElementById('p-name').value = '';
  document.getElementById('p-link').value = '';
  document.getElementById('p-sku').value = '';
  document.getElementById('p-cat').value = '电子产品';
  document.getElementById('p-op-date').value = today();
  document.getElementById('p-note').value = '';

  const currentName = CURRENT_USER?.name || CURRENT_USER?.username || '';
  const defaultQuote = CURRENT_USER && (CURRENT_USER.role === 'quote' || CURRENT_USER.role === 'admin') ? currentName : '';
  const defaultInquiry = CURRENT_USER && (CURRENT_USER.role === 'inquiry' || CURRENT_USER.role === 'admin') ? currentName : '';
  await fillProductUserSelects(defaultQuote, defaultInquiry);

  clearImg();
  openM('mo-product');
}
function handleImgUpload(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById('img-preview');
    img.src = e.target.result;
    img.style.display = 'block';
    document.getElementById('img-placeholder').style.display = 'none';
    document.getElementById('img-upload-area').classList.add('has-img');
  };
  reader.readAsDataURL(file);
}
function handleImgPaste(e) {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') === 0) {
      const blob = items[i].getAsFile();
      const reader = new FileReader();
      reader.onload = ev => {
        const img = document.getElementById('img-preview');
        img.src = ev.target.result;
        img.style.display = 'block';
        document.getElementById('img-placeholder').style.display = 'none';
        document.getElementById('img-upload-area').classList.add('has-img');
      };
      reader.readAsDataURL(blob);
      e.preventDefault();
      return;
    }
  }
}
function clearImg() {
  document.getElementById('img-preview').style.display = 'none';
  document.getElementById('img-placeholder').style.display = 'block';
  document.getElementById('img-upload-area').classList.remove('has-img');
}
async function saveProduct() {
  const id = document.getElementById('ep-id').value;
  const name = document.getElementById('p-name').value.trim();
  if (!name) { toast('请输入产品名称 Please enter a product name', 'err'); return; }

  const quoteUserName = (document.getElementById('p-quote-user').value || '').trim();
  const inquiryUserName = (document.getElementById('p-inquiry-user').value || '').trim();
  if (!quoteUserName) { toast('请选择报价员 Please select a quoter', 'err'); return; }

  const products = await load('products');
  const img = document.getElementById('img-preview').style.display !== 'none' ? document.getElementById('img-preview').src : '';
  const target = id ? products.find(p => p.id === id) : null;
  const data = {
    name,
    sku: document.getElementById('p-sku').value.trim(),
    category: document.getElementById('p-cat').value,
    opDate: document.getElementById('p-op-date').value || today(),
    quoteUserName,
    inquiryUserName,
    opUser: quoteUserName,
    note: document.getElementById('p-note').value.trim(),
    productLink: document.getElementById('p-link').value.trim(),
    image: img,
    status: target?.status || 'pending'
  };
  if (id) {
    const idx = products.findIndex(p => p.id === id);
    if (idx >= 0) { products[idx] = { ...products[idx], ...data, updatedAt: new Date().toISOString() }; toast('产品已更新 Product updated'); }
  } else {
    products.push({ id: gid(), ...data, createdAt: new Date().toISOString() });
    toast('产品已添加 Product added');
  }
  await save('products', products);
  closeM('mo-product');
  renderProducts();
  await renderDash();
}
async function editProduct(id) {
  const products = await load('products');
  const p = products.find(x => x.id === id); if (!p) return;
  document.getElementById('mo-prod-title').textContent = '编辑产品 Edit Product';
  document.getElementById('ep-id').value = p.id;
  document.getElementById('p-name').value = p.name;
  document.getElementById('p-link').value = getProductRefLink(p) || '';
  document.getElementById('p-sku').value = p.sku || '';
  document.getElementById('p-cat').value = p.category || '电子产品';
  document.getElementById('p-op-date').value = p.opDate || fmtD(p.updatedAt || p.createdAt || new Date().toISOString());
  document.getElementById('p-note').value = p.note || '';
  await fillProductUserSelects(p.quoteUserName || p.opUser || '', p.inquiryUserName || '');
  if (p.image) { document.getElementById('img-preview').src = p.image; document.getElementById('img-preview').style.display = 'block'; document.getElementById('img-placeholder').style.display = 'none'; document.getElementById('img-upload-area').classList.add('has-img'); }
  else { clearImg(); }
  openM('mo-product');
}
async function delProduct(id) { if (!confirm('确认删除该产品？Delete this product?')) return; const products = await load('products'); const filteredProducts = products.filter(p => p.id !== id); await save('products', filteredProducts); renderProducts(); await renderDash(); toast('产品已删除 Product deleted'); }

// 产品图片上传模态框相关
let currentProdImgId = null;
async function openProductImgUpload(id) {
  currentProdImgId = id;
  const products = await load('products');
  const p = products.find(x => x.id === id); if (!p) return;
  document.getElementById('prod-img-prod-id').value = id;
  const imgPreview = document.getElementById('prod-img-preview');
  const imgPlaceholder = document.getElementById('prod-img-placeholder');
  const imgArea = document.getElementById('prod-img-upload-area');
  if (p.image) {
    imgPreview.src = p.image; imgPreview.style.display = 'block';
    imgPlaceholder.style.display = 'none';
    imgArea.classList.add('has-img');
  } else {
    imgPreview.style.display = 'none'; imgPlaceholder.style.display = 'block';
    imgArea.classList.remove('has-img');
  }
  openM('mo-prod-img');
}
function handleProdImgUpload(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById('prod-img-preview');
    img.src = e.target.result; img.style.display = 'block';
    document.getElementById('prod-img-placeholder').style.display = 'none';
    document.getElementById('prod-img-upload-area').classList.add('has-img');
  };
  reader.readAsDataURL(file);
}
function handleProdImgPaste(e) {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') === 0) {
      const blob = items[i].getAsFile();
      const reader = new FileReader();
      reader.onload = ev => {
        const img = document.getElementById('prod-img-preview');
        img.src = ev.target.result; img.style.display = 'block';
        document.getElementById('prod-img-placeholder').style.display = 'none';
        document.getElementById('prod-img-upload-area').classList.add('has-img');
      };
      reader.readAsDataURL(blob);
      e.preventDefault();
      return;
    }
  }
}
function clearProdImg() {
  document.getElementById('prod-img-preview').style.display = 'none';
  document.getElementById('prod-img-placeholder').style.display = 'block';
  document.getElementById('prod-img-upload-area').classList.remove('has-img');
}
async function saveProdImg() {
  const id = document.getElementById('prod-img-prod-id').value;
  if (!id) return;
  const products = await load('products');
  const idx = products.findIndex(p => p.id === id);
  if (idx < 0) { toast('产品不存在 Product not found', 'err'); return; }
  const imgPreview = document.getElementById('prod-img-preview');
  if (imgPreview.style.display !== 'none') {
    products[idx].image = imgPreview.src;
  } else {
    delete products[idx].image;
  }
  await save('products', products);
  closeM('mo-prod-img');
  renderProducts();
  toast('产品图片已更新 Product image updated');
}

function downloadProductBatchTemplate() {
  const headers = ['产品名称', '产品链接', '报价员'];
  const sample = [
    ['蓝牙耳机 Pro', 'https://example.com/product/123', '报价员'],
    ['数据线 Type-C', 'https://example.com/product/456', '报价员']
  ];
  const BOM = '\uFEFF';
  let csv = BOM + headers.join(',') + '\n';
  sample.forEach(row => { csv += row.join(',') + '\n'; });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = '产品批量导入模板.csv';
  link.click();
}

async function exportProducts() {
  const products = await load('products');
  if (products.length === 0) { toast('没有产品可导出 No products to export', 'err'); return; }

  // 获取当前筛选条件
  const search = document.getElementById('prod-search').value.toLowerCase();
  const status = document.getElementById('prod-status').value;
  const dateStart = document.getElementById('prod-date-start').value;
  const dateEnd = document.getElementById('prod-date-end').value;
  const quoteUser = document.getElementById('prod-quote-user').value;
  const inquiryUser = document.getElementById('prod-inquiry-user').value;

  // 应用筛选
  let filtered = products.filter(p => {
    const mSearch = !search || [p.name, p.sku, p.quoteUserName, p.inquiryUserName, p.opDate].some(v => (v || '').toString().toLowerCase().includes(search));
    const mStatus = !status || p.status === status;
    const pDate = p.opDate || '';
    const mDateStart = !dateStart || pDate >= dateStart;
    const mDateEnd = !dateEnd || pDate <= dateEnd;
    const mQuoteUser = !quoteUser || p.quoteUserName === quoteUser;
    const mInquiryUser = !inquiryUser || p.inquiryUserName === inquiryUser;
    return mSearch && mStatus && mDateStart && mDateEnd && mQuoteUser && mInquiryUser;
  });

  if (filtered.length === 0) { toast('筛选后没有产品可导出 No products match the current filter', 'err'); return; }

  const headers = ['产品名称', 'SKU', '分类', '状态', '操作日期', '报价员', '询价员', '产品链接', '成本(¥)', '重量(kg)', '采购链接1', '采购链接2', '备注'];
  const statusMap = { pending: '待询价', inquired: '已询价', quoted: '已报价' };
  const BOM = '\uFEFF';
  let csv = BOM + headers.join(',') + '\n';

  filtered.forEach(p => {
    const row = [
      p.name || '',
      p.sku || '',
      p.category || '',
      statusMap[p.status] || '',
      p.opDate || '',
      p.quoteUserName || '',
      p.inquiryUserName || '',
      p.productLink || '',
      p.cost || '',
      p.weight || '',
      p.purchaseLink1 || '',
      p.purchaseLink2 || '',
      p.note || ''
    ];
    // 简单处理CSV中的逗号和引号
    const escapedRow = row.map(v => {
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    });
    csv += escapedRow.join(',') + '\n';
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  const now = new Date().toISOString().slice(0, 10);
  link.download = `产品列表_${now}.csv`;
  link.click();
  toast(`已导出 ${filtered.length} 条产品 Exported ${filtered.length} products`);
}

function openBatchAddProduct() {
  batchProductImportData = [];
  const fileEl = document.getElementById('batch-prod-file');
  const preview = document.getElementById('batch-prod-preview');
  const importBtn = document.getElementById('batch-prod-import-btn');
  if (fileEl) fileEl.value = '';
  if (preview) preview.innerHTML = '<div style="padding:20px;text-align:center;color:var(--gray-400);">请选择模板文件 Please select a template file</div>';
  if (importBtn) importBtn.disabled = true;
  openM('mo-batch-product');
}

function handleBatchProductFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function (e) {
    const buffer = e.target.result;
    const content = decodeImportContent(buffer);
    await parseBatchProductImportData(content);
  };
  reader.readAsArrayBuffer(file);
}

async function parseBatchProductImportData(content) {
  const cleaned = content.replace(/^\uFEFF/, '');
  const lines = cleaned.trim().split(/\r?\n/);
  if (lines.length < 2) { toast('文件内容为空 File is empty', 'err'); return; }

  const quoteUsers = await getAssignableUsers('quote');
  const quoteMap = new Map();
  quoteUsers.forEach(u => {
    const display = (u.name || u.username || '').trim();
    const username = (u.username || '').trim();
    if (display) quoteMap.set(display.toLowerCase(), display);
    if (username) quoteMap.set(username.toLowerCase(), display || username);
  });

  batchProductImportData = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitCsvLine(line).map(c => c.trim());
    if (cols.length < 1) continue;
    const name = cols[0] || '';
    const productLink = cols[1] || '';
    const quoteRaw = cols[2] || '';
    if (!name) continue;

    const currentName = CURRENT_USER?.name || CURRENT_USER?.username || '';
    const normalizedQuote = quoteMap.get(quoteRaw.toLowerCase()) || quoteRaw || currentName;

    batchProductImportData.push({
      name,
      productLink,
      quoteUserName: normalizedQuote
    });
  }
  renderBatchProductImportPreview();
}

function renderBatchProductImportPreview() {
  const preview = document.getElementById('batch-prod-preview');
  const importBtn = document.getElementById('batch-prod-import-btn');
  if (!preview || !importBtn) return;

  if (batchProductImportData.length === 0) {
    preview.innerHTML = '<div style="padding:20px;text-align:center;color:var(--danger);">未找到有效产品数据 No valid product data found</div>';
    importBtn.disabled = true;
    return;
  }

  let html = '<table style="width:100%;font-size:12px;"><thead><tr><th>产品名称 Name</th><th>产品链接 Link</th><th>报价员 Quoter</th></tr></thead><tbody>';
  batchProductImportData.slice(0, 10).forEach(row => {
    html += `<tr><td>${row.name}</td><td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${row.productLink || '-'}</td><td>${row.quoteUserName || '-'}</td></tr>`;
  });
  if (batchProductImportData.length > 10) html += `<tr><td colspan="3" style="text-align:center;">...还有 ${batchProductImportData.length - 10} 条</td></tr>`;
  html += '</tbody></table>';
  preview.innerHTML = html;
  importBtn.disabled = false;
}

async function saveBatchProduct() {
  if (batchProductImportData.length === 0) { toast('请先上传模板并解析 Please upload and parse a template file first', 'err'); return; }
  const products = await load('products');
  let added = 0;
  batchProductImportData.forEach(row => {
    products.push({
      id: gid(),
      name: row.name,
      sku: '',
      category: '其他',
      opDate: today(),
      quoteUserName: row.quoteUserName || (CURRENT_USER?.name || CURRENT_USER?.username || ''),
      inquiryUserName: '',
      opUser: row.quoteUserName || (CURRENT_USER?.name || CURRENT_USER?.username || ''),
      note: '',
      productLink: row.productLink || '',
      status: 'pending',
      createdAt: new Date().toISOString()
    });
    added++;
  });

  await save('products', products);
  closeM('mo-batch-product');
  renderProducts();
  await renderDash();
  toast(`批量导入了 ${added} 个产品 Bulk imported ${added} products`);
}

// ===========================
// Inquiry (询价员)
// ===========================
let inqMoreRealImages = [];
async function renderInquiry() {
  const products = await load('products');
  const pendingProducts = products.filter(p => p.status === 'pending');
  document.getElementById('inquiry-count').textContent = pendingProducts.length;
  const list = document.getElementById('inquiry-list');
  if (pendingProducts.length === 0) { list.innerHTML = '<div class="empty-state"><p>暂无待询价产品 No unsourced products</p></div>'; return; }
  list.innerHTML = pendingProducts.map(p => {
    const img = p.image ? `<img src="${p.image}" style="width:80px;height:80px;object-fit:cover;border-radius:6px;">` : `<div style="width:80px;height:80px;background:var(--gray-100);border-radius:6px;display:flex;align-items:center;justify-content:center;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--gray-300)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>`;
    const link = getProductRefLink(p);
    const linkHtml = link
      ? `<div style="margin-top:6px;">
          <div style="font-size:11px;color:var(--gray-500);margin-bottom:4px;">产品参考链接 Reference Link</div>
          <a href="${link}" target="_blank" style="display:inline-flex;align-items:center;gap:6px;color:var(--primary);font-size:12px;text-decoration:none;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            ${link}
          </a>
        </div>`
      : '';
    return `<div style="display:flex;gap:16px;padding:16px;border-bottom:1px solid var(--gray-100);align-items:center;">
      ${img}
      <div style="flex:1;">
        <div style="font-weight:600;margin-bottom:4px;">${p.name}</div>
        <div style="font-size:12px;color:var(--gray-500);">${p.sku || '无SKU No SKU'} · ${p.category || '未分类 Uncategorized'}</div>
        ${linkHtml}
      </div>
      <button class="btn btn-primary" onclick="open1688Search('${p.id}')">去询价 Source</button>
    </div>`;
  }).join('');
}
// ===========================
// 1688 Supplier Search
// ===========================
let s1688ProductId = null;
let s1688SelectedSupplier = null;
let s1688CurrentProduct = null;
let s1688ResultItems = [];

const S1688_SPIN = `<svg class="spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2.5" style="vertical-align:middle;margin-right:6px;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;

function normalize1688Item(item, fallbackUrl) {
  const priceMin = item.priceRange?.[0] ?? item.price ?? item.priceText ?? '';
  const priceMax = item.priceRange?.[1] ?? '';
  const price = priceMax && priceMax !== priceMin ? `¥${priceMin}~¥${priceMax}` : (priceMin ? `¥${priceMin}` : '--');
  const score = item.shopScore ?? item.sellerScore ?? item.creditLevel ?? '--';
  return {
    title: item.title || item.name || item.itemTitle || '未知产品',
    img:   item.imgUrl || item.image || item.picUrl || item.pic || item.mainImage || '',
    price,
    moq:   item.minOrderQuantity ?? item.minOrderQty ?? item.moq ?? item.minPurchaseNum ?? '--',
    shop:  item.shopName || item.sellerName || item.companyName || '--',
    score: typeof score === 'number' ? score.toFixed(1) : String(score),
    url:   item.detailUrl || item.itemUrl || item.url || fallbackUrl || ''
  };
}

async function open1688Search(productId) {
  const products = await load('products');
  const p = products.find(x => x.id === productId);
  if (!p) return;
  s1688ProductId = productId;
  s1688CurrentProduct = p;
  s1688SelectedSupplier = null;
  s1688ResultItems = [];

  document.getElementById('s1688-product-name').textContent = p.name;
  document.getElementById('s1688-prod-title').textContent = p.name;

  const imgEl = document.getElementById('s1688-prod-img');
  const imgPh = document.getElementById('s1688-prod-img-ph');
  const imgSrc = p.realImage || p.image || '';
  if (imgSrc) { imgEl.src = imgSrc; imgEl.style.display = 'block'; imgPh.style.display = 'none'; }
  else { imgEl.style.display = 'none'; imgPh.style.display = 'flex'; }

  document.getElementById('s1688-search-status-line').textContent = '';
  document.getElementById('s1688-results-area').innerHTML = '';
  document.getElementById('s1688-msg-section').style.display = 'none';
  document.getElementById('s1688-url-input').value = '';
  document.getElementById('s1688-detail-status').innerHTML = '';
  document.getElementById('s1688-retry-btn').style.display = 'none';
  document.getElementById('s1688-manual-section').removeAttribute('open');
  document.getElementById('btn-1688-proceed').disabled = true;

  openM('mo-1688');
  doSearch1688();
}

async function doSearch1688() {
  const p = s1688CurrentProduct;
  const area = document.getElementById('s1688-results-area');
  const statusLine = document.getElementById('s1688-search-status-line');
  const retryBtn = document.getElementById('s1688-retry-btn');

  s1688ResultItems = [];
  s1688SelectedSupplier = null;
  retryBtn.style.display = 'none';
  document.getElementById('s1688-msg-section').style.display = 'none';
  document.getElementById('btn-1688-proceed').disabled = true;

  area.innerHTML = `<div style="text-align:center;padding:28px;color:var(--gray-500);font-size:13px;">${S1688_SPIN}正在翻译关键词... Translating...</div>`;
  statusLine.textContent = '';

  // Keyword search and translation are not available on the current TMAPI plan.
  // Skip straight to the manual URL fallback with a helpful prompt.
  area.innerHTML = `<div style="text-align:center;padding:24px 16px;color:var(--gray-500);font-size:13px;line-height:1.6;">
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--gray-300)" stroke-width="1.5" style="display:block;margin:0 auto 10px;"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
    在1688搜索"<b>${p.name}</b>"，找到产品后复制链接粘贴到下方<br>
    <span style="font-size:11px;color:var(--gray-400);">Search 1688 for this product, then paste the product URL below</span>
  </div>`;
  statusLine.textContent = '请手动搜索并粘贴链接';
  document.getElementById('s1688-manual-section').setAttribute('open', '');
}

function renderSearch1688Cards() {
  const area = document.getElementById('s1688-results-area');
  area.innerHTML = s1688ResultItems.map((s, i) => `
    <div id="s1688-card-${i}" class="s1688-result-item" onclick="select1688Supplier(${i})"
      style="display:flex;gap:12px;padding:11px 13px;border:2px solid var(--gray-200);border-radius:8px;
             cursor:pointer;margin-bottom:8px;transition:all 0.15s;align-items:flex-start;">
      ${s.img
        ? `<img src="${s.img}" style="width:68px;height:68px;object-fit:cover;border-radius:6px;flex-shrink:0;" onerror="this.style.display='none'">`
        : `<div style="width:68px;height:68px;background:var(--gray-100);border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center;"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--gray-300)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>`}
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;margin-bottom:4px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${s.title}</div>
        <div style="font-size:12px;color:var(--gray-600);margin-bottom:5px;">🏪 ${s.shop}</div>
        <div style="display:flex;flex-wrap:wrap;gap:10px;font-size:12px;">
          <span style="color:var(--danger);font-weight:600;">${s.price}</span>
          <span style="color:var(--gray-500);">起订量 MOQ: <b>${s.moq}</b></span>
          <span style="color:var(--gray-500);">评分 <b>${s.score}</b></span>
        </div>
      </div>
      <div id="s1688-check-${i}" style="display:none;flex-shrink:0;width:22px;height:22px;background:var(--primary);
           border-radius:50%;color:white;font-size:13px;align-items:center;justify-content:center;margin-top:2px;">✓</div>
    </div>`).join('');
}

function select1688Supplier(idx) {
  s1688SelectedSupplier = s1688ResultItems[idx];
  if (!s1688SelectedSupplier) return;

  s1688ResultItems.forEach((_, i) => {
    const card = document.getElementById(`s1688-card-${i}`);
    const check = document.getElementById(`s1688-check-${i}`);
    if (card) card.classList.remove('selected');
    if (check) check.style.display = 'none';
  });

  const selCard = document.getElementById(`s1688-card-${idx}`);
  const selCheck = document.getElementById(`s1688-check-${idx}`);
  if (selCard) selCard.classList.add('selected');
  if (selCheck) selCheck.style.display = 'flex';

  document.getElementById('btn-1688-proceed').disabled = false;
  generate1688SupplierMsg(s1688SelectedSupplier);
}

function extract1688ItemId(url) {
  if (!url) return null;
  const m = url.match(/offer[/](\d+)/i);
  if (m) return m[1];
  const n = url.match(/(\d{8,})/);
  return n ? n[1] : null;
}

async function fetch1688ItemDetail() {
  const url = document.getElementById('s1688-url-input').value.trim();
  const statusEl = document.getElementById('s1688-detail-status');
  const spin = document.getElementById('s1688-fetch-spin');

  if (!url) { toast('请先粘贴1688产品链接 Paste a 1688 product URL first', 'err'); return; }

  const itemId = extract1688ItemId(url);
  if (!itemId) {
    statusEl.innerHTML = `<div style="color:var(--danger);font-size:12px;">无法识别商品ID，请确认是有效的1688链接 Could not extract item ID</div>`;
    return;
  }

  if (spin) spin.style.display = 'inline-block';
  statusEl.innerHTML = `<div style="color:var(--gray-500);font-size:12px;margin-top:4px;">${S1688_SPIN}正在获取商品详情... Fetching...</div>`;
  document.getElementById('btn-1688-proceed').disabled = true;
  s1688SelectedSupplier = null;

  try {
    const res = await fetch(`/api/tmapi?endpoint=detail&item_id=${encodeURIComponent(itemId)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const d = json?.data || json;

    s1688SelectedSupplier = normalize1688Item(d, url);

    // Inject the manually-fetched result as a single selectable card at the top of results area
    s1688ResultItems = [s1688SelectedSupplier];
    renderSearch1688Cards();
    select1688Supplier(0);

    statusEl.innerHTML = '';
    document.getElementById('s1688-manual-section').removeAttribute('open');

  } catch (err) {
    console.error('[1688 detail] error:', err);
    statusEl.innerHTML = `<div style="color:var(--danger);font-size:12px;margin-top:4px;">获取失败 Failed: ${err.message}</div>`;
  } finally {
    if (spin) spin.style.display = 'none';
  }
}

function generate1688SupplierMsg(supplier) {
  const p = s1688CurrentProduct;
  const productName = p?.name || supplier.title;
  const sku = p?.sku ? `\nSKU：${p.sku}` : '';
  const msg = `您好！

我司是DSA公司，在贵店看到以下产品，想了解详细情况：

产品名称：${productName}${sku}
参考产品：${supplier.title}
参考价格：${supplier.price}
起订量：${supplier.moq}

烦请告知以下信息：
1. 该产品目前最新的价格及阶梯报价是多少？
2. 最小起订量是多少？是否支持小批量订购？
3. 现货情况如何？如需生产，大概需要多久？
4. 是否可以提供样品？样品费及运费如何计算？
5. 是否支持定制（颜色/尺寸/标签/包装）？

期待您的回复，谢谢！`;
  document.getElementById('s1688-msg').value = msg;
  document.getElementById('s1688-msg-section').style.display = 'block';
}

function copySupplierMsg() {
  const msg = document.getElementById('s1688-msg').value;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(msg).then(() => toast('消息已复制 Message copied')).catch(() => fallbackCopyMsg(msg));
  } else {
    fallbackCopyMsg(msg);
  }
}

function fallbackCopyMsg(msg) {
  const ta = document.getElementById('s1688-msg');
  ta.select();
  try { document.execCommand('copy'); toast('消息已复制 Message copied'); } catch { toast('复制失败 Copy failed', 'err'); }
}

function proceed1688ToInquiry() {
  const link = s1688SelectedSupplier?.url || '';
  closeM('mo-1688');
  setTimeout(() => openInquiryModal(s1688ProductId, link), 280);
}

function skip1688ToInquiry() {
  closeM('mo-1688');
  setTimeout(() => openInquiryModal(s1688ProductId), 280);
}

async function openInquiryModal(id, prefillLink) {
  const products = await load('products');
  const p = products.find(x => x.id === id); if (!p) return;
  document.getElementById('inq-id').value = p.id;
  document.getElementById('inq-name').textContent = p.name;
  // 产品图片
  if (p.image) { document.getElementById('inq-img').src = p.image; document.getElementById('inq-img').style.display = 'block'; }
  else { document.getElementById('inq-img').style.display = 'none'; }
  // 实拍图
  const rp2 = document.getElementById('inq-real-preview');
  const rph = document.getElementById('inq-real-placeholder');
  if (p.realImage) {
    rp2.src = p.realImage; rp2.style.display = 'block';
    if (rph) rph.style.display = 'none';
    document.getElementById('inq-real-img-area').classList.add('has-img');
  } else {
    rp2.src = ''; rp2.style.display = 'none';
    if (rph) rph.style.display = 'block';
    document.getElementById('inq-real-img-area').classList.remove('has-img');
  }
  // 尺码表
  const sp = document.getElementById('inq-size-preview');
  const sph = document.getElementById('inq-size-placeholder');
  if (p.sizeChartImage) {
    sp.src = p.sizeChartImage; sp.style.display = 'block';
    if (sph) sph.style.display = 'none';
    document.getElementById('inq-size-img-area').classList.add('has-img');
  } else {
    if (sp) { sp.src = ''; sp.style.display = 'none'; }
    if (sph) sph.style.display = 'block';
    document.getElementById('inq-size-img-area').classList.remove('has-img');
  }
  // 更多实拍图
  inqMoreRealImages = Array.isArray(p.realImages) ? [...p.realImages] : [];
  renderMoreRealImages();
  // 显示产品链接
  const linkDisplay = document.getElementById('inq-link-display');
  const link = getProductRefLink(p);
  if (link) {
    linkDisplay.innerHTML = `<a href="${link}" target="_blank" style="display:inline-flex;align-items:center;gap:4px;color:var(--primary);font-size:13px;text-decoration:none;padding:6px 12px;background:var(--primary-light);border-radius:4px;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      查看产品参考链接 View Reference Link
    </a>`;
  } else {
    linkDisplay.innerHTML = '<span style="color:var(--gray-400);font-size:12px;">暂无产品参考链接 No reference link</span>';
  }
  document.getElementById('inq-weight').value = p.weight || '';
  document.getElementById('inq-cost').value = p.cost || '';
  document.getElementById('inq-link1').value = prefillLink || p.purchaseLink1 || '';
  document.getElementById('inq-link2').value = p.purchaseLink2 || '';
  document.getElementById('inq-note').value = p.inquiryNote || '';
  openM('mo-inquiry');
}
function handleRealImgUpload(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const rp = document.getElementById('inq-real-preview');
    const rph = document.getElementById('inq-real-placeholder');
    rp.src = e.target.result; rp.style.display = 'block';
    if (rph) rph.style.display = 'none';
    document.getElementById('inq-real-img-area').classList.add('has-img');
  };
  reader.readAsDataURL(file);
}
function handleRealImgPaste(e) {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') === 0) {
      const blob = items[i].getAsFile();
      const reader = new FileReader();
      reader.onload = ev => {
        const rp = document.getElementById('inq-real-preview');
        const rph = document.getElementById('inq-real-placeholder');
        rp.src = ev.target.result; rp.style.display = 'block';
        if (rph) rph.style.display = 'none';
        document.getElementById('inq-real-img-area').classList.add('has-img');
      };
      reader.readAsDataURL(blob);
      e.preventDefault();
      return;
    }
  }
}

function handleSizeChartUpload(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const preview = document.getElementById('inq-size-preview');
    const placeholder = document.getElementById('inq-size-placeholder');
    preview.src = e.target.result; preview.style.display = 'block';
    if (placeholder) placeholder.style.display = 'none';
    document.getElementById('inq-size-img-area').classList.add('has-img');
  };
  reader.readAsDataURL(file);
}

function handleSizeChartPaste(e) {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') === 0) {
      const blob = items[i].getAsFile();
      const reader = new FileReader();
      reader.onload = ev => {
        const preview = document.getElementById('inq-size-preview');
        const placeholder = document.getElementById('inq-size-placeholder');
        preview.src = ev.target.result; preview.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';
        document.getElementById('inq-size-img-area').classList.add('has-img');
      };
      reader.readAsDataURL(blob);
      e.preventDefault();
      return;
    }
  }
}

function clearSizeChart() {
  const preview = document.getElementById('inq-size-preview');
  const placeholder = document.getElementById('inq-size-placeholder');
  if (preview) { preview.src = ''; preview.style.display = 'none'; }
  if (placeholder) placeholder.style.display = 'block';
  const area = document.getElementById('inq-size-img-area');
  if (area) area.classList.remove('has-img');
}

function renderMoreRealImages() {
  const wrap = document.getElementById('inq-more-real-list');
  if (!wrap) return;
  if (!Array.isArray(inqMoreRealImages) || inqMoreRealImages.length === 0) {
    wrap.innerHTML = '<div class="thumb-empty">暂无更多实拍图 No additional photos</div>';
    return;
  }
  wrap.innerHTML = inqMoreRealImages.map((src, idx) => {
    return `<div class="thumb-item"><img src="${src}" alt="实拍图"><button class="thumb-remove" onclick="removeMoreRealImage(${idx}); event.stopPropagation();">×</button></div>`;
  }).join('');
}

function removeMoreRealImage(idx) {
  if (!Array.isArray(inqMoreRealImages)) return;
  inqMoreRealImages.splice(idx, 1);
  renderMoreRealImages();
}

function clearMoreRealImages() {
  inqMoreRealImages = [];
  renderMoreRealImages();
}

function handleMoreRealUpload(input) {
  const files = Array.from(input.files || []);
  if (files.length === 0) return;
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      inqMoreRealImages.push(e.target.result);
      renderMoreRealImages();
    };
    reader.readAsDataURL(file);
  });
  input.value = '';
}

function handleMoreRealPaste(e) {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  let added = false;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') === 0) {
      const blob = items[i].getAsFile();
      const reader = new FileReader();
      reader.onload = ev => {
        inqMoreRealImages.push(ev.target.result);
        renderMoreRealImages();
      };
      reader.readAsDataURL(blob);
      added = true;
    }
  }
  if (added) e.preventDefault();
}

async function saveInquiry() {
  const id = document.getElementById('inq-id').value;
  const weight = parseFloat(document.getElementById('inq-weight').value);
  const cost = parseFloat(document.getElementById('inq-cost').value);
  if (!weight || weight <= 0) { toast('请输入有效的产品重量 Please enter a valid product weight', 'err'); return; }
  if (!cost || cost <= 0) { toast('请输入有效的产品成本 Please enter a valid product cost', 'err'); return; }
  const products = await load('products');
  const idx = products.findIndex(p => p.id === id);
  if (idx >= 0) {
    const prevStatus = products[idx].status;
    if (prevStatus === 'quoted') {
      const ok = confirm('该产品已报价，修改询价信息会将状态改为已询价，需要重新报价，是否继续？\nThis product has been quoted. Editing sourcing info will reset its status. Continue?');
      if (!ok) return;
    }
    const prevWeight = products[idx].weight;
    const prevCost = products[idx].cost;
    const prevWeightNum = Number(prevWeight);
    const prevCostNum = Number(prevCost);
    const hasPrev = Number.isFinite(prevWeightNum) || Number.isFinite(prevCostNum);
    const changed = (Number.isFinite(prevWeightNum) && prevWeightNum !== weight) || (Number.isFinite(prevCostNum) && prevCostNum !== cost);
    if (hasPrev && changed) {
      const history = Array.isArray(products[idx].inquiryHistory) ? products[idx].inquiryHistory : [];
      history.push({
        changedAt: new Date().toISOString(),
        prevWeight: Number.isFinite(prevWeightNum) ? prevWeightNum : prevWeight,
        prevCost: Number.isFinite(prevCostNum) ? prevCostNum : prevCost,
        weight,
        cost
      });
      products[idx].inquiryHistory = history;
    }

    products[idx].weight = weight;
    products[idx].cost = cost;

    products[idx].purchaseLink1 = document.getElementById('inq-link1').value.trim();

    products[idx].purchaseLink2 = document.getElementById('inq-link2').value.trim();
    products[idx].inquiryNote = document.getElementById('inq-note').value.trim();
    // 保存实拍图
    const rp = document.getElementById('inq-real-preview');
    if (rp && rp.src && rp.style.display !== 'none') {
      products[idx].realImage = rp.src;
    }
    // 保存尺码表
    const sp = document.getElementById('inq-size-preview');
    if (sp && sp.src && sp.style.display !== 'none') {
      products[idx].sizeChartImage = sp.src;
    } else {
      delete products[idx].sizeChartImage;
    }
    // 保存更多实拍图
    if (Array.isArray(inqMoreRealImages) && inqMoreRealImages.length > 0) {
      products[idx].realImages = [...inqMoreRealImages];
    } else {
      delete products[idx].realImages;
    }
    if (!products[idx].inquiryUserName) {
      products[idx].inquiryUserName = CURRENT_USER?.name || CURRENT_USER?.username || '';
    }
    products[idx].status = 'inquired';
    products[idx].inquiredAt = new Date().toISOString();
    await save('products', products);
    toast('询价信息已保存 Sourcing info saved');
    closeM('mo-inquiry');
    await renderInquiry();
    renderProducts();
    await renderDash();
  }
}

function fmtInquiryNum(val, decimals = 2) {
  const num = Number(val);
  if (!Number.isFinite(num)) return '-';
  return num.toFixed(decimals);
}

async function openInquiryHistory(pid) {
  const products = await load('products');
  const p = products.find(x => x.id === pid);
  if (!p) { toast('未找到该产品 Product not found', 'err'); return; }
  const history = Array.isArray(p.inquiryHistory) ? [...p.inquiryHistory].reverse() : [];
  const title = document.getElementById('inq-history-title');
  const body = document.getElementById('inq-history-body');
  if (title) title.textContent = `${p.name} · 询价修改记录 Sourcing Edit History`;
  let html = `<div style="margin-bottom:10px;font-size:12px;color:var(--gray-600);">当前 Current：${fmtInquiryNum(p.weight)}kg / ¥${fmtInquiryNum(p.cost)}</div>`;
  if (history.length === 0) {
    html += '<div class="empty-state" style="padding:20px;"><p>暂无修改记录 No edit history</p></div>';
  } else {
    html += '<div style="display:flex;flex-direction:column;gap:8px;">' + history.map(h => {
      const time = fmtDT(h.changedAt);
      const prevText = `${fmtInquiryNum(h.prevWeight)}kg / ¥${fmtInquiryNum(h.prevCost)}`;
      const nextText = `${fmtInquiryNum(h.weight)}kg / ¥${fmtInquiryNum(h.cost)}`;
      return `<div style="border:1px solid var(--gray-100);border-radius:6px;padding:10px;background:var(--gray-50);">
        <div style="font-size:11px;color:var(--gray-500);margin-bottom:6px;">${time}</div>
        <div style="font-size:13px;"><strong>${prevText}</strong> → <strong>${nextText}</strong></div>
      </div>`;
    }).join('') + '</div>';
  }
  if (body) body.innerHTML = html;
  openM('mo-inquiry-history');
}

// ===========================
// Quote Generate (报价员)
// ===========================

let qgSelectedProducts = [];
let qgSelectedCountries = [];
let qgLastLogiId = '';
let currentQuoteResult = null;

async function initQuoteGen() {
  // 填充物流商下拉
  const logistics = await load('logistics');
  const lsel = document.getElementById('qg-logi');
  lsel.innerHTML = '<option value="">-- 选择物流商 Select Logistics --</option>' + logistics.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
  lsel.onchange = () => { renderQuoteCountries(); };
  qgSelectedProducts = [];
  qgSelectedCountries = [];
  document.getElementById('qg-result-card').style.display = 'none';
  await renderProductSelect();
  await renderQuoteCountries();
}
async function renderProductSelect() {
  const products = await load('products');
  const filteredProducts = products.filter(p => p.status === 'inquired' || p.status === 'quoted');
  const search = document.getElementById('qg-prod-search').value.toLowerCase();
  let filtered = filteredProducts.filter(p => !search || p.name.toLowerCase().includes(search));
  const grid = document.getElementById('qg-prod-grid');
  if (filtered.length === 0) { grid.innerHTML = '<div style="padding:20px;text-align:center;color:var(--gray-400);">无产品 No products</div>'; document.getElementById('qg-prod-count').textContent = '0'; return; }
  grid.innerHTML = filtered.map(p => {
    const sel = qgSelectedProducts.includes(p.id);
    const img = p.realImage || p.image;
    const imgHtml = img
      ? `<img src="${img}" style="width:60px;height:60px;object-fit:cover;border-radius:4px;">`
      : `<div style="width:60px;height:60px;background:var(--gray-100);border-radius:4px;display:flex;align-items:center;justify-content:center;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--gray-300)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>`;
    return `<div class="qg-prod-item" style="${sel ? 'background:var(--primary);color:white;' : 'background:white;border:1px solid var(--gray-200);'}padding:10px;border-radius:6px;cursor:pointer;display:flex;gap:10px;align-items:center;" onclick="toggleProduct('${p.id}')">
      <input type="checkbox" ${sel ? 'checked' : ''} style="margin:0;">
      ${imgHtml}
      <div style="flex:1;min-width:0;"><div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.name}</div><div style="font-size:11px;color:var(--gray-500);">${p.weight}kg / ¥${p.cost}</div></div>
    </div>`;
  }).join('');
  document.getElementById('qg-prod-count').textContent = qgSelectedProducts.length;
}
function toggleProduct(pid) {
  const idx = qgSelectedProducts.indexOf(pid);
  if (idx >= 0) qgSelectedProducts.splice(idx, 1);
  else qgSelectedProducts.push(pid);
  renderProductSelect();
}
function toggleCountry(code) {
  const idx = qgSelectedCountries.indexOf(code);
  if (idx >= 0) qgSelectedCountries.splice(idx, 1);
  else qgSelectedCountries.push(code);
}

async function renderQuoteCountries() {
  const cgrid = document.getElementById('qg-countries');
  const lsel = document.getElementById('qg-logi');
  const searchInput = document.getElementById('qg-country-search');
  if (!cgrid || !lsel) return;
  const lid = lsel.value;

  if (lid !== qgLastLogiId) {
    qgSelectedCountries = [];
    qgLastLogiId = lid;
  }

  if (!lid) {
    cgrid.innerHTML = '<div style="color:var(--gray-500);font-size:12px;">请先选择物流商 Please select a logistics provider first</div>';
    return;
  }

  const freight = await load('freight');
  const allCountries = loadCountries();
  if (!allCountries.length) {
    cgrid.innerHTML = '<div style="color:var(--gray-500);font-size:12px;">暂无国家数据 No country data</div>';
    return;
  }

  const keyword = (searchInput?.value || '').trim().toLowerCase();
  const matchCountry = (country) => {
    if (!keyword) return true;
    const name = (country.name || '').toLowerCase();
    const code = (country.code || '').toLowerCase();
    if (name.includes(keyword) || code.includes(keyword)) return true;
    const parts = splitCountryCodes(country.code).map(s => s.toLowerCase());
    return parts.some(p => p.includes(keyword));
  };

  const filteredCountries = allCountries.filter(matchCountry);
  if (filteredCountries.length === 0) {
    cgrid.innerHTML = '<div style="color:var(--gray-500);font-size:12px;">未找到匹配国家 No matching countries</div>';
    return;
  }

  const freightForLogi = freight.filter(f => f.logisticsId === lid);
  const hasRule = (country) => freightForLogi.some(f => countryMatchesFreight(country, f.country));

  cgrid.innerHTML = filteredCountries.map(c => {
    const available = hasRule(c);
    const codeEsc = JSON.stringify(c.code).slice(1, -1);
    const label = `${c.name} (${c.code})`;
    const hint = available ? '' : ' <span style="color:var(--gray-400);font-size:11px;">无运费规则 No rate</span>';
    const title = available ? '' : '无运费规则 No freight rule';
    const checked = qgSelectedCountries.includes(c.code) ? 'checked' : '';
    return `<label class="country-item" title="${title}"><input type="checkbox" value="${codeEsc}" ${checked} onchange="toggleCountry('${codeEsc}')"> ${label}${hint}</label>`;
  }).join('');
}



async function generateQuote() {
  const pids = qgSelectedProducts;
  const lid = document.getElementById('qg-logi').value;
  const profit = parseFloat(document.getElementById('qg-profit').value) || 15;
  const rate = parseFloat(document.getElementById('qg-rate').value) || 7;
  if (pids.length === 0) { toast('请至少选择一个产品 Please select at least one product', 'err'); return; }
  if (!lid) { toast('请选择物流商 Please select a logistics provider', 'err'); return; }
  if (qgSelectedCountries.length === 0) { toast('请至少选择一个国家 Please select at least one country', 'err'); return; }
  const allProducts = await load('products');
  const products = allProducts.filter(p => pids.includes(p.id));
  const logistics = (await load('logistics')).find(l => l.id === lid);
  const freight = await load('freight');
  const hasInvalid = products.some(p => !p || !p.weight);
  if (hasInvalid) { toast('有产品尚未完成询价 Some products have not been sourced yet', 'err'); return; }
  if (!logistics) { toast('物流商不存在 Logistics provider not found', 'err'); return; }

  // 计算结果：每个产品 x 每个国家
  const results = [];
  const missingCountries = [];
  products.forEach(product => {
    qgSelectedCountries.forEach(countryCode => {
      // 尝试用代码/别名/名称匹配
      const countryName = getCountryName(countryCode);
      const countryObj = { name: countryName, code: countryCode };
      const fr = freight.find(f => f.logisticsId === lid && countryMatchesFreight(countryObj, f.country));
      if (!fr) {
        missingCountries.push(`${product.name} x ${countryName} (no freight rule)`);
        return;
      }

      const zone = fr.zones.find(z => {
        const w = parseFloat(product.weight);
        const min = parseFloat(z.min);
        const max = parseFloat(z.max);
        return w >= min && w <= max;
      });
      if (!zone) {
        missingCountries.push(`${product.name} x ${getCountryName(countryCode)} (no matching weight zone)`);
        return;
      }
      const freightCost = product.weight * zone.freight + zone.registration;
      const totalCost = product.cost + freightCost;
      const quoteCNY = totalCost * (1 + profit / 100);
      const quoteUSD = quoteCNY / rate;
      results.push({ productName: product.name, countryCode, weight: product.weight, cost: product.cost, freight: zone.freight, registration: zone.registration, freightCost, totalCost, quoteCNY, quoteUSD, profit, rate });
    });
  });

  if (missingCountries.length > 0) {
    toast('以下国家缺少运费规则 Missing freight rules for: ' + missingCountries.join(', '), 'err');
    return;
  }
  if (results.length === 0) {
    toast('所选国家暂无运费规则 No freight rules for selected countries', 'err');
    return;
  }

  currentQuoteResult = { products, logistics, results, profit, rate, createdAt: new Date().toISOString() };

  // 展示产品成本与运费成本（USD）
  let html = '<table class="quote-table"><thead><tr><th>产品 Product</th><th>国家 Country</th><th>产品成本 Cost(USD)</th><th>运费成本 Freight(USD)</th><th>报价 Quote(USD)</th></tr></thead><tbody>';
  results.forEach(r => {
    const cost = Number(r.cost);
    const freightCost = Number(r.freightCost);
    const rateNum = Number(rate);
    const profitRate = 1 + profit / 100;
    const costUSD = Number.isFinite(cost) && rateNum > 0 ? (cost * profitRate) / rateNum : NaN;
    const freightUSD = Number.isFinite(freightCost) && rateNum > 0 ? (freightCost * profitRate) / rateNum : NaN;
    const costText = Number.isFinite(costUSD) ? costUSD.toFixed(2) : '-';
    const freightText = Number.isFinite(freightUSD) ? freightUSD.toFixed(2) : '-';
    html += `<tr><td>${r.productName}</td><td>${r.countryCode}</td><td>$${costText}</td><td>$${freightText}</td><td style="color:var(--success);font-weight:600;">$${r.quoteUSD.toFixed(2)}</td></tr>`;
  });
  html += '</tbody></table>';

  document.getElementById('qg-result-table').innerHTML = html;
  document.getElementById('qg-result-card').style.display = 'block';
}
function copyQuoteTable() {
  if (!currentQuoteResult) return;
  const rows = currentQuoteResult.results.map(r => {
    const cost = Number(r.cost);
    const freightCost = Number(r.freightCost);
    const rateNum = Number(currentQuoteResult.rate);
    const profitRate = 1 + Number(currentQuoteResult.profit || 0) / 100;
    const costUSD = Number.isFinite(cost) && rateNum > 0 ? (cost * profitRate) / rateNum : NaN;
    const freightUSD = Number.isFinite(freightCost) && rateNum > 0 ? (freightCost * profitRate) / rateNum : NaN;
    const costText = Number.isFinite(costUSD) ? costUSD.toFixed(2) : '-';
    const freightText = Number.isFinite(freightUSD) ? freightUSD.toFixed(2) : '-';
    return `${r.productName}\t${r.countryCode}\t${costText}\t${freightText}\t${r.quoteUSD.toFixed(2)}`;
  });
  const text = '产品 Product\t国家 Country\t产品成本 Cost(USD)\t运费成本 Freight(USD)\t报价 Quote(USD)\n' + rows.join('\n');
  navigator.clipboard.writeText(text).then(() => toast('表格已复制到剪贴板 Table copied to clipboard'));
}

async function saveQuote() {
  if (!currentQuoteResult) return;
  const products = currentQuoteResult.products;
  const resultsByProduct = {};
  currentQuoteResult.results.forEach(r => {
    const key = r.productName;
    if (!resultsByProduct[key]) resultsByProduct[key] = { countries: [], details: [] };
    resultsByProduct[key].countries.push(r.countryCode);
    resultsByProduct[key].details.push(r);
  });

  const allProducts = await load('products');
  const quotes = await load('quotes');
  for (const p of products) {
    const quote = {
      id: 'Q' + Date.now() + Math.random().toString(36).substr(2, 4),
      productId: p.id,
      productName: p.name,
      productImage: p.image || '',
      realImage: p.realImage || '',
      inquiryNote: p.inquiryNote || '',
      logisticsId: currentQuoteResult.logistics.id,
      logisticsName: currentQuoteResult.logistics.name,
      countries: resultsByProduct[p.name]?.countries || [],
      details: resultsByProduct[p.name]?.details || [],
      profit: currentQuoteResult.profit,
      rate: currentQuoteResult.rate,
      avgPriceUSD: resultsByProduct[p.name] ? (resultsByProduct[p.name].details.reduce((a, b) => a + b.quoteUSD, 0) / resultsByProduct[p.name].details.length).toFixed(2) : '0',
      createdAt: new Date().toISOString()
    };
    quotes.push(quote);
    const pidx = allProducts.findIndex(prod => prod.id === p.id);
    if (pidx >= 0) { allProducts[pidx].status = 'quoted'; }
  }
  await save('products', allProducts);
  await save('quotes', quotes);
  toast(`报价已保存 Quote saved (${products.length} products × ${currentQuoteResult.results.length / products.length} countries)`);
  await nav('quotes');
}

// ===========================
// Quotes
// ===========================
async function renderQuotes() {
  const quotes = await load('quotes');
  const tbody = document.getElementById('quotes-tbody');
  if (quotes.length === 0) { tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--gray-500);">暂无报价记录 No quote records</td></tr>'; return; }
  const idEsc = (id) => JSON.stringify(id).slice(1, -1);
  tbody.innerHTML = quotes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(q => {
    const img = q.realImage || q.productImage;
    const imgHtml = img
      ? `<img src="${img}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;">`
      : `<div style="width:40px;height:40px;background:var(--gray-100);border-radius:4px;display:flex;align-items:center;justify-content:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gray-300)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>`;

    const details = Array.isArray(q.details) ? q.details : [];
    const detailMap = new Map(details.map(d => {
      const key = d.countryCode || d.country || d.countryName || '';
      return [key, d];
    }));
    const countryList = Array.isArray(q.countries) && q.countries.length
      ? q.countries
      : details.map(d => d.countryCode || d.country || d.countryName).filter(Boolean);
    const rows = countryList.length ? countryList : [''];
    const span = rows.length;

    const baseCells = `
    <td rowspan="${span}" style="text-align:center;"><input type="checkbox" class="quote-chk" data-qid="${idEsc(q.id)}"></td>
    <td rowspan="${span}" style="text-align:center;">${imgHtml}</td>
    <td rowspan="${span}">${q.id}</td>
    <td rowspan="${span}">${q.productName}</td>
    <td rowspan="${span}">${q.logisticsName}</td>`;
    const tailCells = `
    <td rowspan="${span}">${fmtD(q.createdAt)}</td>
    <td rowspan="${span}"><button class="btn btn-sm btn-outline" onclick="viewQuote('${idEsc(q.id)}')">查看 View</button><button class="btn btn-sm btn-danger" onclick="delQuote('${idEsc(q.id)}')" style="margin-left:8px;">删除 Del</button></td>`;

    return rows.map((code, idx) => {
      const detail = detailMap.get(code) || details.find(d => (d.countryCode || d.country || d.countryName) === code) || null;
      const country = code ? getCountryName(code) : '-';
      const priceValue = detail ? Number(detail.quoteUSD) : NaN;
      const priceHtml = Number.isFinite(priceValue)
        ? `<span style="color:var(--success);font-weight:600;">$${priceValue.toFixed(2)}</span>`
        : '<span style="color:var(--gray-400);">-</span>';
      if (idx === 0) {
        return `<tr>${baseCells}
          <td>${country}</td>
          <td>${priceHtml}</td>
          ${tailCells}
        </tr>`;
      }
      return `<tr>
        <td>${country}</td>
        <td>${priceHtml}</td>
      </tr>`;
    }).join('');
  }).join('');
  updateQuoteExportBtn();
}
async function viewQuote(id) {
  const quotes = await load('quotes');
  const q = quotes.find(x => x.id === id); if (!q) return;
  const modal = document.getElementById('mo-quote-detail');
  modal.dataset.qid = id;
  modal.dataset.pid = q.productId || '';
  let imgHtml = '';

  if (q.productImage || q.realImage) {
    imgHtml = '<div style="display:flex;gap:16px;margin-bottom:16px;">';
    if (q.productImage) imgHtml += `<div style="text-align:center;"><div style="font-size:11px;color:var(--gray-500);margin-bottom:4px;">产品图片 Product Image</div><img src="${q.productImage}" style="width:100px;height:100px;object-fit:cover;border-radius:6px;border:1px solid var(--gray-200);"></div>`;
    if (q.realImage) imgHtml += `<div style="text-align:center;"><div style="font-size:11px;color:var(--gray-500);margin-bottom:4px;">实拍图 Real Photo</div><img src="${q.realImage}" style="width:100px;height:100px;object-fit:cover;border-radius:6px;border:1px solid var(--gray-200);"></div>`;
    imgHtml += '</div>';
  }
  let html = imgHtml;
  html += `<div style="margin-bottom:12px;font-size:13px;background:var(--gray-50);padding:10px;border-radius:6px;">
    <strong>产品 Product:</strong> ${q.productName} &nbsp;|&nbsp; <strong>物流商 Logistics:</strong> ${q.logisticsName} &nbsp;|&nbsp; <strong>利润率 Profit:</strong> ${q.profit}% &nbsp;|&nbsp; <strong>汇率 Rate:</strong> 1USD=¥${q.rate}
  </div>`;
  if (q.inquiryNote) html += `<div style="margin-bottom:12px;font-size:12px;color:var(--gray-600);background:#fffbeb;padding:8px;border-radius:6px;">备注 Notes: ${q.inquiryNote}</div>`;
  // 报价详情：包含成本（含利润）
  const detailRate = Number(q.rate);
  const detailProfitRate = 1 + Number(q.profit || 0) / 100;
  html += '<table class="quote-table"><thead><tr><th>产品 Product</th><th>国家 Country</th><th>产品成本 Cost(USD)</th><th>运费成本 Freight(USD)</th><th>报价 Quote(USD)</th></tr></thead><tbody>';
  q.details.forEach(r => {
    const cost = Number(r.cost);
    const freightCost = Number(r.freightCost);
    const costUSD = Number.isFinite(cost) && detailRate > 0 ? (cost * detailProfitRate) / detailRate : NaN;
    const freightUSD = Number.isFinite(freightCost) && detailRate > 0 ? (freightCost * detailProfitRate) / detailRate : NaN;
    const costText = Number.isFinite(costUSD) ? costUSD.toFixed(2) : '-';
    const freightText = Number.isFinite(freightUSD) ? freightUSD.toFixed(2) : '-';
    html += `<tr><td>${r.productName}</td><td>${r.countryCode}</td><td>$${costText}</td><td>$${freightText}</td><td style="color:var(--success);font-weight:600;">$${r.quoteUSD.toFixed(2)}</td></tr>`;
  });
  html += '</tbody></table>';
  document.getElementById('quote-detail-body').innerHTML = html;
  openM('mo-quote-detail');
}
async function copyQuoteDetail() {
  const qid = document.getElementById('mo-quote-detail').dataset.qid;
  const quotes = await load('quotes');
  const q = quotes.find(x => x.id === qid);
  if (!q) { toast('无法复制 Cannot copy', 'err'); return; }
  const rateNum = Number(q.rate);
  const profitRate = 1 + Number(q.profit || 0) / 100;
  const rows = q.details.map(r => {
    const cost = Number(r.cost);
    const freightCost = Number(r.freightCost);
    const costUSD = Number.isFinite(cost) && rateNum > 0 ? (cost * profitRate) / rateNum : NaN;
    const freightUSD = Number.isFinite(freightCost) && rateNum > 0 ? (freightCost * profitRate) / rateNum : NaN;
    const costText = Number.isFinite(costUSD) ? costUSD.toFixed(2) : '-';
    const freightText = Number.isFinite(freightUSD) ? freightUSD.toFixed(2) : '-';
    return `${r.productName}\t${r.countryCode}\t${costText}\t${freightText}\t${r.quoteUSD.toFixed(2)}`;
  });
  const text = '产品 Product\t国家 Country\t产品成本 Cost(USD)\t运费成本 Freight(USD)\t报价 Quote(USD)\n' + rows.join('\n');
  navigator.clipboard.writeText(text).then(() => toast('表格已复制到剪贴板 Table copied to clipboard'));
}

async function delQuote(id) { if (!confirm('确认删除该报价？Delete this quote?')) return; const quotes = await load('quotes'); const filteredQuotes = quotes.filter(q => q.id !== id); await save('quotes', filteredQuotes); await renderQuotes(); toast('报价已删除 Quote deleted'); }

function toggleAllQuotes(cb) { document.querySelectorAll('.quote-chk').forEach(c => c.checked = cb.checked); updateQuoteExportBtn(); }
function updateQuoteExportBtn() {
  const checked = document.querySelectorAll('.quote-chk:checked').length;
  const btn = document.getElementById('quote-batch-export-btn');
  const delBtn = document.getElementById('quote-batch-del-btn');
  const selAll = document.getElementById('quote-chk-all');
  if (btn) { btn.disabled = checked === 0; btn.textContent = checked > 0 ? `批量导出 Export Selected (${checked})` : '批量导出 Export Selected'; }
  if (delBtn) { delBtn.disabled = checked === 0; delBtn.textContent = checked > 0 ? `批量删除 Delete Selected (${checked})` : '批量删除 Delete Selected'; }
  if (selAll) {
    const all = document.querySelectorAll('.quote-chk').length;
    selAll.indeterminate = checked > 0 && checked < all;
    selAll.checked = all > 0 && checked === all;
  }
}
async function batchExportQuotes() {
  const checked = document.querySelectorAll('.quote-chk:checked');
  if (checked.length === 0) return;
  const quotes = await load('quotes');
  const qids = Array.from(checked).map(c => c.dataset.qid);
  const selected = quotes.filter(q => qids.includes(q.id));
  if (selected.length === 0) { toast('未找到选中的记录 No selected records found', 'err'); return; }
  let csv = '\uFEFF' + '产品Product,物流商Logistics,国家Country,产品成本Product Cost(USD),运费成本Shipping Cost(USD),报价Quotation(USD),时间Date\n';
  selected.forEach(q => {
    const details = Array.isArray(q.details) ? q.details : [];
    const rateNum = Number(q.rate);
    const profitRate = 1 + Number(q.profit || 0) / 100;
    if (details.length === 0) {
      csv += `${q.productName},${q.logisticsName},,,,,${fmtD(q.createdAt)}\n`;
      return;
    }
    details.forEach(r => {
      const cost = Number(r.cost);
      const freightCost = Number(r.freightCost);
      const costUSD = Number.isFinite(cost) && rateNum > 0 ? (cost * profitRate) / rateNum : NaN;
      const freightUSD = Number.isFinite(freightCost) && rateNum > 0 ? (freightCost * profitRate) / rateNum : NaN;
      const costText = Number.isFinite(costUSD) ? costUSD.toFixed(2) : '';
      const freightText = Number.isFinite(freightUSD) ? freightUSD.toFixed(2) : '';
      csv += `${q.productName},${q.logisticsName},${r.countryCode},${costText},${freightText},${r.quoteUSD.toFixed(2)},${fmtD(q.createdAt)}\n`;
    });
  });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `报价记录_${today()}.csv`;
  link.click();
  toast(`已导出 ${selected.length} 条记录 Exported ${selected.length} records`);
}

async function batchDelQuotes() {
  const checked = document.querySelectorAll('.quote-chk:checked');
  if (checked.length === 0) return;
  if (!confirm(`确认删除选中的 ${checked.length} 条报价记录？\nDelete ${checked.length} selected quote records?`)) return;
  const quotes = await load('quotes');
  const qids = new Set(Array.from(checked).map(c => c.dataset.qid));
  const filtered = quotes.filter(q => !qids.has(q.id));
  await save('quotes', filtered);
  await renderQuotes();
  toast(`已删除 ${checked.length} 条记录 Deleted ${checked.length} records`);
}
function renderCountryList() {
  const countries = loadCountries();
  const list = document.getElementById('country-list');
  if (!list) return;
  list.innerHTML = countries.map(c => `<div style="display:flex;justify-content:space-between;padding:8px;border-bottom:1px solid var(--gray-100);align-items:center;gap:8px;">
    <span>${c.name} (${c.code})</span>
    <div style="display:flex;gap:6px;">
      <button class="btn btn-sm btn-outline" onclick="editCountry('${c.code}')">编辑 Edit</button>
      <button class="btn btn-sm btn-danger" onclick="delCountry('${c.code}')">删除 Del</button>
    </div>
  </div>`).join('');
}

function openCountryModal() {
  renderCountryList();
  cancelCountryEdit();
  openM('mo-country');
}

function editCountry(code) {
  const countries = loadCountries();
  const c = countries.find(x => x.code === code);
  if (!c) return;
  document.getElementById('country-name').value = c.name;
  document.getElementById('country-code').value = c.code;
  document.getElementById('country-edit-code').value = c.code;
  const btn = document.getElementById('country-save-btn');
  const cancelBtn = document.getElementById('country-cancel-btn');
  if (btn) btn.textContent = '保存修改 Save Edit';
  if (cancelBtn) cancelBtn.style.display = 'inline-flex';
}

function cancelCountryEdit() {
  const editInput = document.getElementById('country-edit-code');
  if (editInput) editInput.value = '';
  document.getElementById('country-name').value = '';
  document.getElementById('country-code').value = '';
  const btn = document.getElementById('country-save-btn');
  const cancelBtn = document.getElementById('country-cancel-btn');
  if (btn) btn.textContent = '添加国家 Add Country';
  if (cancelBtn) cancelBtn.style.display = 'none';
}

function saveCountry() {
  const name = document.getElementById('country-name').value.trim();
  const code = document.getElementById('country-code').value.trim().toUpperCase();
  if (!name || !code) { toast('请输入国家名称和缩写 Please enter country name and code', 'err'); return; }
  if (!/^[A-Z]{2,3}(\/[A-Z]{2,3})?$/.test(code)) { toast('缩写应为 2-3 个大写字母，可用 / 分隔 Code must be 2-3 uppercase letters, / allowed', 'err'); return; }
  const countries = loadCountries();
  const editCode = document.getElementById('country-edit-code').value;

  if (editCode) {
    const idx = countries.findIndex(c => c.code === editCode);
    if (idx < 0) { toast('未找到待编辑国家 Country not found', 'err'); return; }
    if (code !== editCode && countries.some(c => c.code === code)) { toast('该缩写已存在 This code already exists', 'err'); return; }
    countries[idx] = { name, code };
    saveCountries(countries);
    cancelCountryEdit();
    renderCountryList();
    renderQuoteCountries();
    toast('国家已更新 Country updated');
    return;
  }

  if (countries.some(c => c.code === code)) { toast('该缩写已存在 This code already exists', 'err'); return; }
  countries.push({ name, code });
  saveCountries(countries);
  cancelCountryEdit();
  renderCountryList();
  renderQuoteCountries();
  toast('国家已添加 Country added');
}

function delCountry(code) {
  if (!confirm('确认删除该国家？Delete this country?')) return;
  const countries = loadCountries().filter(c => c.code !== code);
  saveCountries(countries);
  renderCountryList();
  renderQuoteCountries();
  toast('国家已删除 Country deleted');
}
async function exportQuotes() {
  const quotes = await load('quotes');
  if (quotes.length === 0) { toast('暂无数据可导出 No data to export', 'err'); return; }
  const headers = ['报价单号Quote No.', '产品Product', '物流商Logistics', '国家数Countries', '平均报价Avg Quote(USD)', '利润率Profit(%)', '汇率Rate', '创建时间Date'];
  const rows = quotes.map(q => [q.id, q.productName, q.logisticsName, q.countries.length, q.avgPriceUSD, q.profit, q.rate, fmtD(q.createdAt)]);
  let csv = '\uFEFF' + headers.join(',') + '\n' + rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `报价记录_${today()}.csv`;
  link.click();
  toast('报价记录已导出 Quote records exported');
}

// ===========================
// Logistics (管理员)
// ===========================
async function renderLogistics() {
  const logistics = await load('logistics');
  const tbody = document.getElementById('logistics-tbody');
  if (logistics.length === 0) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--gray-500);">暂无物流商 No logistics providers</td></tr>'; return; }
  const idEsc = (id) => JSON.stringify(id).slice(1, -1);
  tbody.innerHTML = logistics.map(l => `<tr>
    <td><strong>${l.name}</strong></td>
    <td>${l.code || '-'}</td>
    <td>${l.contact || '-'}</td>
    <td>
      <button class="btn btn-sm btn-outline" onclick="editLogi('${idEsc(l.id)}')">编辑 Edit</button>
      <button class="btn btn-sm btn-danger" onclick="delLogi('${idEsc(l.id)}')" style="margin-left:8px;">删除 Del</button>
    </td>
  </tr>`).join('');
  refreshFreightLogi();
}
function openAddLogi() {
  const title = document.getElementById('mo-logi-title');
  const idEl = document.getElementById('el-id');
  const nameEl = document.getElementById('l-name');
  const codeEl = document.getElementById('l-code');
  const contactEl = document.getElementById('l-contact');
  if (!title || !idEl || !nameEl || !codeEl || !contactEl) {
    toast('物流商弹窗元素缺失，请刷新页面 Modal elements missing, please refresh', 'err');
    return;
  }
  title.textContent = '添加物流商 Add Logistics';
  idEl.value = '';
  nameEl.value = '';
  codeEl.value = '';
  contactEl.value = '';
  openM('mo-logi');
}
async function saveLogi() {
  const idEl = document.getElementById('el-id');
  const nameEl = document.getElementById('l-name');
  if (!nameEl) { toast('物流商表单未就绪，请刷新页面 Form not ready, please refresh', 'err'); return; }
  const id = idEl ? idEl.value : '';
  const name = nameEl.value.trim();
  if (!name) { toast('请输入物流商名称 Please enter a logistics name', 'err'); return; }
  const logistics = await load('logistics');
  const codeEl = document.getElementById('l-code');
  const contactEl = document.getElementById('l-contact');
  const data2 = { name, code: codeEl ? codeEl.value.trim() : '', contact: contactEl ? contactEl.value.trim() : '' };
  if (id) {
    const idx = logistics.findIndex(l => l.id === id);
    if (idx >= 0) { logistics[idx] = { ...logistics[idx], ...data2, updatedAt: new Date().toISOString() }; toast('物流商已更新 Logistics updated'); }
  } else {
    logistics.push({ id: gid(), ...data2, createdAt: new Date().toISOString() });
    toast('物流商已添加 Logistics added');
  }
  await save('logistics', logistics);
  closeM('mo-logi');
  await renderLogistics();
  await renderDash();
}
async function editLogi(id) {
  const logistics = await load('logistics');
  const l = logistics.find(x => x.id === id); if (!l) return;
  const title = document.getElementById('mo-logi-title');
  const idEl = document.getElementById('el-id');
  const nameEl = document.getElementById('l-name');
  const codeEl = document.getElementById('l-code');
  const contactEl = document.getElementById('l-contact');
  if (!title || !idEl || !nameEl || !codeEl || !contactEl) {
    toast('物流商弹窗元素缺失，请刷新页面 Modal elements missing, please refresh', 'err');
    return;
  }
  title.textContent = '编辑物流商 Edit Logistics';
  idEl.value = l.id;
  nameEl.value = l.name;
  codeEl.value = l.code || '';
  contactEl.value = l.contact || '';
  openM('mo-logi');
}
async function delLogi(id) { if (!confirm('确认删除该物流商？相关运费规则也会删除。\nDelete this logistics provider? Related freight rules will also be deleted.')) return; const logistics = await load('logistics'); const filteredLogistics = logistics.filter(l => l.id !== id); await save('logistics', filteredLogistics); const freight = await load('freight'); const filteredFreight = freight.filter(f => f.logisticsId !== id); await save('freight', filteredFreight); await renderLogistics(); await renderFreight(); await renderDash(); toast('物流商已删除 Logistics deleted'); }

// ===========================
// Freight (管理员)
// ===========================
let freightZones = [];
async function renderFreight() {
  const freight = await load('freight'), logistics = await load('logistics');
  const logMap = Object.fromEntries(logistics.map(l => [l.id, l.name]));
  const logiF = document.getElementById('freight-logi-f').value;
  const search = document.getElementById('freight-search').value.toLowerCase();
  let filtered = freight.filter(f => (!logiF || f.logisticsId === logiF) && (!search || f.country.toLowerCase().includes(search)));
  filtered.sort((a, b) => { if (a.logisticsId !== b.logisticsId) return a.logisticsId.localeCompare(b.logisticsId); return a.country.localeCompare(b.country) });
  const list = document.getElementById('freight-list'), empty = document.getElementById('freight-empty');
  if (filtered.length === 0) { list.innerHTML = ''; empty.style.display = 'block'; updateBatchDelBtn(); return; }
  empty.style.display = 'none';

  let rows = [];
  filtered.forEach(f => {
    const logiName = logMap[f.logisticsId] || '未知 Unknown';
    f.zones.forEach((z, idx) => {
      rows.push({ freightId: f.id, logiName, country: f.country, zoneIndex: idx, min: z.min, max: z.max, freight: z.freight, registration: z.registration });
    });
  });

  // 用 JSON 转义 ID，确保 onclick 不会截断
  const fidEsc = (id) => JSON.stringify(id).slice(1, -1); // 去掉首尾引号，但保留转义
  list.innerHTML = rows.map(r => `<tr>
    <td style="width:36px;text-align:center;"><input type="checkbox" class="freight-chk" data-fid="${fidEsc(r.freightId)}" data-zidx="${r.zoneIndex}"></td>
    <td>${r.logiName}</td>
    <td>${r.country}</td>
    <td>${r.min} - ${r.max} kg</td>
    <td>¥${r.freight}/kg</td>
    <td>¥${r.registration}</td>
    <td>
      <button class="btn btn-sm btn-outline" onclick="editFreight('${fidEsc(r.freightId)}')">编辑 Edit</button>
      <button class="btn btn-sm btn-danger" onclick="delFreightZone('${fidEsc(r.freightId)}',${r.zoneIndex})" style="margin-left:8px;">删除 Del</button>
    </td>
  </tr>`).join('');

  updateBatchDelBtn();
}
async function refreshFreightLogi() {
  const logistics = await load('logistics');
  const sel = document.getElementById('freight-logi-f');
  const cur = sel.value;
  sel.innerHTML = '<option value="">全部物流商 All Logistics</option>' + logistics.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
  sel.value = cur;
  const fsel = document.getElementById('f-logi');
  if (fsel) { const fcur = fsel.value; fsel.innerHTML = '<option value="">-- 选择物流商 Select Logistics --</option>' + logistics.map(l => `<option value="${l.id}">${l.name}</option>`).join(''); fsel.value = fcur; }
  const dl = document.getElementById('country-dl');
  if (dl) {
    const countries = loadCountries();
    dl.innerHTML = countries.map(c => `<option value="${c.name}">${c.name} (${c.code})</option>`).join('');
  }
}
function openAddFreight() {
  document.getElementById('mo-freight-title').textContent = '添加运费规则 Add Freight Rule';
  document.getElementById('ef-id').value = '';
  document.getElementById('f-logi').value = '';
  document.getElementById('f-country').value = '';
  document.getElementById('f-note').value = '';
  freightZones = [];
  renderZones();
  openM('mo-freight');
}
function renderZones() {
  const wrap = document.getElementById('f-zones');
  if (freightZones.length === 0) { wrap.innerHTML = '<div style="font-size:12.5px;color:var(--gray-400);">暂无区间，请添加 No zones, click Add Zone</div>'; return; }
  wrap.innerHTML = freightZones.map((z, i) => `<div class="zone-row">
    <div class="zone-header"><span>区间 Zone ${i + 1}</span><button class="btn btn-sm btn-danger" onclick="delZone(${i})">删除 Del</button></div>
    <div class="zone-fields">
      <input type="number" placeholder="最小kg" value="${z.min}" onchange="updateZone(${i},'min',this.value)">
      <input type="number" placeholder="最大kg" value="${z.max}" onchange="updateZone(${i},'max',this.value)">
      <input type="number" placeholder="运费¥/kg" value="${z.freight}" onchange="updateZone(${i},'freight',this.value)">
      <input type="number" placeholder="挂号费¥" value="${z.registration}" onchange="updateZone(${i},'registration',this.value)">
    </div>
  </div>`).join('');
}
function addZone() { freightZones.push({ min: 0, max: 2, freight: 50, registration: 30 }); renderZones(); }
function delZone(i) { freightZones.splice(i, 1); renderZones(); }
function updateZone(i, k, v) { freightZones[i][k] = parseFloat(v) || 0; }
async function saveFreight() {
  const logisticsId = document.getElementById('f-logi').value;
  const country = document.getElementById('f-country').value.trim();
  if (!logisticsId) { toast('请选择物流商 Please select a logistics provider', 'err'); return; }
  if (!country) { toast('请输入国家 Please enter a country', 'err'); return; }
  if (freightZones.length === 0) { toast('请至少添加一个重量区间 Please add at least one weight zone', 'err'); return; }
  const countries = loadCountries();
  const countryObj = countries.find(c => c.name === country);
  const countryCode = countryObj ? countryObj.code : country;
  const zones = freightZones.map(z => ({ min: parseFloat(z.min) || 0, max: parseFloat(z.max) || 999, freight: parseFloat(z.freight) || 0, registration: parseFloat(z.registration) || 0 })).sort((a, b) => a.min - b.min);
  const freight = await load('freight');
  const id = document.getElementById('ef-id').value;
  const data = { logisticsId, country: countryCode, zones, note: document.getElementById('f-note').value.trim() };
  if (id) {
    const idx = freight.findIndex(f => f.id === id);
    if (idx >= 0) { freight[idx] = { ...freight[idx], ...data, updatedAt: new Date().toISOString() }; toast('运费规则已更新 Freight rule updated'); }
  } else {
    freight.push({ id: gid(), ...data, createdAt: new Date().toISOString() });
    toast('运费规则已添加 Freight rule added');
  }
  await save('freight', freight);
  closeM('mo-freight');
  await renderFreight();
}
async function editFreight(id) {
  const freight = await load('freight');
  const f = freight.find(x => x.id === id); if (!f) return;
  document.getElementById('mo-freight-title').textContent = '编辑运费规则 Edit Freight Rule';
  document.getElementById('ef-id').value = f.id;
  document.getElementById('f-logi').value = f.logisticsId;
  document.getElementById('f-country').value = f.country;
  document.getElementById('f-note').value = f.note || '';
  freightZones = (f.zones || []).map(z => ({ min: z.min, max: z.max, freight: z.freight, registration: z.registration }));
  renderZones();
  openM('mo-freight');
}
async function delFreightZone(id, zoneIndex) {
  console.log('[delFreightZone] id:', id, 'zoneIndex:', zoneIndex);
  if (!confirm('确认删除该重量区间？Delete this weight zone?')) {
    console.log('[delFreightZone] cancelled');
    return;
  }
  const freight = await load('freight');
  console.log('[delFreightZone] freight before:', freight);
  const fi = freight.findIndex(f => f.id === id);
  console.log('[delFreightZone] fi:', fi);
  if (fi < 0) {
    console.log('[delFreightZone] not found');
    toast('未找到该规则，请刷新页面 Rule not found, please refresh', 'err');
    return;
  }
  freight[fi].zones.splice(zoneIndex, 1);
  if (freight[fi].zones.length === 0) {
    freight.splice(fi, 1);
    toast('区间已删除（规则已清空，整条规则同步删除）Zone deleted (rule now empty, full rule also removed)');
  } else {
    toast('区间已删除 Zone deleted');
  }
  await save('freight', freight);
  await renderFreight();
}
async function delFreight(id) { if (!confirm('确认删除该运费规则？Delete this freight rule?')) return; const freight = await load('freight'); const filteredFreight = freight.filter(f => f.id !== id); await save('freight', filteredFreight); await renderFreight(); }

// 批量删除
function updateBatchDelBtn() {
  const checked = document.querySelectorAll('.freight-chk:checked').length;
  const btn = document.getElementById('freight-batch-del-btn');
  const selAll = document.getElementById('freight-chk-all');
  if (btn) { btn.disabled = checked === 0; btn.textContent = checked > 0 ? `批量删除 Delete Selected (${checked})` : '批量删除 Delete Selected'; }
  if (selAll) {
    const all = document.querySelectorAll('.freight-chk').length;
    selAll.indeterminate = checked > 0 && checked < all;
    selAll.checked = all > 0 && checked === all;
  }
}
function toggleAllFreight(cb) {
  document.querySelectorAll('.freight-chk').forEach(c => c.checked = cb.checked);
  updateBatchDelBtn();
}
async function batchDelFreight() {
  const checked = document.querySelectorAll('.freight-chk:checked');
  if (checked.length === 0) return;
  if (!confirm(`确认删除选中的 ${checked.length} 个重量区间？\nDelete ${checked.length} selected weight zones?`)) return;
  const freight = await load('freight');
  const toDelete = Array.from(checked).map(c => ({ fid: c.dataset.fid, zidx: parseInt(c.dataset.zidx, 10) }));
  const grouped = {};
  toDelete.forEach(({ fid, zidx }) => { if (!grouped[fid]) grouped[fid] = []; grouped[fid].push(zidx); });
  Object.entries(grouped).forEach(([fid, idxList]) => {
    const fi = freight.findIndex(f => f.id === fid);
    if (fi < 0) return;
    idxList.sort((a, b) => b - a).forEach(zidx => freight[fi].zones.splice(zidx, 1));
    if (freight[fi].zones.length === 0) freight.splice(fi, 1);
  });
  await save('freight', freight);
  toast(`已删除 ${checked.length} 个区间 Deleted ${checked.length} zones`);
  await renderFreight();
}

// 一次性初始化运费表格事件（绑在不变的父容器上）
function initFreightEvents() {
  const wrapper = document.querySelector('#page-freight .table-wrapper');
  console.log('[initFreightEvents] wrapper:', wrapper);
  if (!wrapper || wrapper._freightEvtBound) {
    console.log('[initFreightEvents] skip:', !wrapper ? 'no wrapper' : 'already bound');
    return;
  }
  wrapper._freightEvtBound = true;
  wrapper.addEventListener('click', function(e) {
    const target = e.target;
    const editBtn = target.closest('.freight-edit-btn');
    const delBtn  = target.closest('.freight-del-btn');
    const chk     = target.closest('.freight-chk');
    console.log('[freight click] target:', target.tagName, 'className:', target.className);
    console.log('[freight click] buttons:', { editBtn: !!editBtn, delBtn: !!delBtn, chk: !!chk });
    if (editBtn) editFreight(editBtn.dataset.fid);
    if (delBtn)  delFreightZone(delBtn.dataset.fid, parseInt(delBtn.dataset.zidx, 10));
    if (chk)     updateBatchDelBtn();
  }, false); // false = 冒泡阶段捕获，更可靠
  console.log('[initFreightEvents] bound');
}

// ===========================
// Batch Import
// ===========================
let importData = [];
function downloadTemplate() {
  const headers = ['物流商名称', '类别(general/sensitive)', '国家', '国家代码', '最小重量(KG)', '最大重量(KG)', '单价(元/KG)', '挂号费(元/件)'];
  const sample = [['云途物流', 'general', '德国', 'DE', '0', '2', '50', '30'], ['云途物流', 'general', '德国', 'DE', '2.01', '5', '45', '30'], ['云途物流', 'general', '美国', 'US', '0', '2', '60', '20']];
  const BOM = '\uFEFF';
  let csv = BOM + headers.join(',') + '\n';
  sample.forEach(row => { csv += row.join(',') + '\n' });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = '运费标准导入模板.csv';
  link.click();
}
function openImportModal() {
  importData = [];
  document.getElementById('import-file').value = '';
  document.getElementById('import-preview').innerHTML = '<div style="padding:20px;text-align:center;color:var(--gray-400);">请选择文件</div>';
  document.getElementById('btn-confirm-import').disabled = true;
  openM('modal-import');
}
function decodeImportContent(buffer) {
  const tryDecode = (encoding) => new TextDecoder(encoding).decode(buffer);
  let text = '';
  try {
    text = tryDecode('utf-8');
  } catch (e) {
    text = '';
  }
  // 如果包含替换字符，尝试使用 GBK
  if (!text || text.includes(' ') || text.includes('�')) {
    try {
      text = tryDecode('gbk');
    } catch (e) {
      // fallback
    }
  }
  return text;
}

function splitCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    const buffer = e.target.result;
    const content = decodeImportContent(buffer);
    parseImportData(content);
  };
  reader.readAsArrayBuffer(file);
}
function parseImportData(content) {
  // 去掉 UTF-8 BOM
  const cleaned = content.replace(/^\uFEFF/, '');
  const lines = cleaned.trim().split(/\r?\n/);
  if (lines.length < 2) { toast('文件内容为空 File is empty', 'err'); return; }
  importData = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitCsvLine(line).map(c => c.trim());
    if (cols.length < 8) continue;
    const [carrierName, category, country, code, minWeight, maxWeight, unitPrice, handlingFee] = cols;
    if (!carrierName || !country) continue;
    importData.push({ carrierName, category: category === 'sensitive' ? 'sensitive' : 'general', country, code: code.toUpperCase(), minWeight: parseFloat(minWeight) || 0, maxWeight: parseFloat(maxWeight) || 999, unitPrice: parseFloat(unitPrice) || 0, handlingFee: parseFloat(handlingFee) || 0 });
  }
  renderImportPreview();
}
function renderImportPreview() {
  const preview = document.getElementById('import-preview');
  if (importData.length === 0) { preview.innerHTML = '<div style="padding:20px;text-align:center;color:var(--danger);">未找到有效数据 No valid data found</div>'; document.getElementById('btn-confirm-import').disabled = true; return; }
  let html = '<table style="width:100%;font-size:12px;"><thead><tr><th>物流商 Logistics</th><th>国家 Country</th><th>重量段 Weight</th><th>单价 Price</th><th>挂号费 Reg.</th></tr></thead><tbody>';
  importData.slice(0, 10).forEach(row => { html += `<tr><td>${row.carrierName}</td><td>${row.country}</td><td>${row.minWeight}-${row.maxWeight}kg</td><td>¥${row.unitPrice}</td><td>¥${row.handlingFee}</td></tr>`; });
  if (importData.length > 10) html += `<tr><td colspan="5" style="text-align:center;">...还有 ${importData.length - 10} 条</td></tr>`;
  html += '</tbody></table>';
  preview.innerHTML = html;
  document.getElementById('btn-confirm-import').disabled = false;
}
async function confirmImport() {
  if (importData.length === 0) return;
  const mode = document.getElementById('import-mode').value;
  if (mode === 'replace') { if (!confirm('确定替换所有数据？Replace all existing data?')) return; }
  const logistics = await load('logistics');
  const freight = mode === 'replace' ? [] : await load('freight');
  const logMap = new Map();
  logistics.forEach(l => logMap.set(l.name, l));
  importData.forEach(row => {
    let logi = logMap.get(row.carrierName);
    if (!logi) {
      logi = { id: gid(), name: row.carrierName, code: '', contact: '', createdAt: new Date().toISOString() };
      logistics.push(logi);
      logMap.set(row.carrierName, logi);
    }
    let fr = freight.find(f => f.logisticsId === logi.id && f.country === row.country);
    if (!fr) {
      fr = { id: gid(), logisticsId: logi.id, country: row.country, zones: [], createdAt: new Date().toISOString() };
      freight.push(fr);
    }
    const zidx = fr.zones.findIndex(z => z.min === row.minWeight && z.max === row.maxWeight);
    const zone = { min: row.minWeight, max: row.maxWeight, freight: row.unitPrice, registration: row.handlingFee };
    if (zidx >= 0) fr.zones[zidx] = zone;
    else fr.zones.push(zone);
  });
  await save('logistics', logistics);
  await save('freight', freight);
  closeM('modal-import');
  await renderLogistics();
  await renderFreight();
  toast(`成功导入 ${importData.length} 条记录 Imported ${importData.length} records`);
}

// ===========================
// Init
// ===========================
async function initData() {
  // If no directory handle, data lives in localStorage (default on web)
  if (!DATA_DIR_HANDLE) {
    const products = await load('products');
    const logistics = await load('logistics');
    if (logistics.length === 0 && products.length === 0) {
      initLocalStorageData();
    }
  }
}

// 选择数据目录
async function chooseDataDirectory() {
  try {
    DATA_DIR_HANDLE = await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'desktop'
    });
    DATA_DIR_NAME = DATA_DIR_HANDLE?.name || '';
    await storeDirHandle(DATA_DIR_HANDLE);
    renderDataDirDisplay();
    toast('数据目录已设置 Data directory set: ' + DATA_DIR_HANDLE.name);

    // 保存版本号
    localStorage.setItem('qms_version', 'v4.0');

    // 迁移旧数据（如果有）
    await migrateFromLocalStorage();

    // 检查是否需要初始化数据
    const products = await load('products');
    const logistics = await load('logistics');

    if (logistics.length === 0) {
      await initRealData();
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      console.log('用户取消了目录选择');
      toast('未选择数据目录，将使用 localStorage No directory selected, using localStorage', 'info');
    } else {
      console.error('选择目录失败:', e);
      toast('选择数据目录失败 Failed to select directory: ' + e.message, 'err');
    }
  }
}


// 从 localStorage 迁移数据到文件
async function migrateFromLocalStorage() {
  const keys = ['products', 'logistics', 'freight', 'quotes'];
  let migrated = 0;
  for (const k of keys) {
    const stored = localStorage.getItem(STORAGE[k]);
    if (stored) {
      const data = JSON.parse(stored);
      if (data.length > 0) {
        await save(k, data);
        migrated += data.length;
      }
      localStorage.removeItem(STORAGE[k]);
    }
  }
  if (migrated > 0) {
    toast(`已迁移 ${migrated} 条数据到文件 Migrated ${migrated} records to file`, 'ok');
  }
}

// 初始化真实示例数据（从实际 Excel 提取的真实数据）
async function initRealData() {
  // 真实物流商
  const logistics = [
    { id: 'l_yuntu', name: '云途物流', type: 'general', code: 'YT', contact: 'contact@yuntu.com', createdAt: new Date().toISOString() },
    { id: 'l_ems', name: '中国邮政 EMS', type: 'general', code: 'EMS', contact: '', createdAt: new Date().toISOString() },
    { id: 'l_dhl', name: 'DHL', type: 'general', code: 'DHL', contact: '', createdAt: new Date().toISOString() },
    { id: 'l_ups', name: 'UPS', type: 'general', code: 'UPS', contact: '', createdAt: new Date().toISOString() },
    { id: 'l_fedex', name: 'FedEx', type: 'general', code: 'FDX', contact: '', createdAt: new Date().toISOString() }
  ];
  await save('logistics', logistics);

  // 真实运费规则（从 Excel 提取的实际价格）
  const freight = [
    // 云途物流 - 德国
    { id: 'f_yt_de_1', logisticsId: 'l_yuntu', country: 'DE', zones: [{ min: 0, max: 0.1, freight: 90, registration: 30 }, { min: 0.11, max: 0.3, freight: 85, registration: 30 }, { min: 0.31, max: 0.5, freight: 80, registration: 30 }, { min: 0.51, max: 1, freight: 75, registration: 30 }], createdAt: new Date().toISOString() },
    { id: 'f_yt_de_2', logisticsId: 'l_yuntu', country: 'DE', zones: [{ min: 1.01, max: 2, freight: 70, registration: 30 }, { min: 2.01, max: 3, freight: 65, registration: 30 }, { min: 3.01, max: 5, freight: 60, registration: 30 }], createdAt: new Date().toISOString() },
    // 云途物流 - 美国
    { id: 'f_yt_us_1', logisticsId: 'l_yuntu', country: 'US', zones: [{ min: 0, max: 0.1, freight: 110, registration: 20 }, { min: 0.11, max: 0.3, freight: 105, registration: 20 }, { min: 0.31, max: 0.5, freight: 100, registration: 20 }], createdAt: new Date().toISOString() },
    { id: 'f_yt_us_2', logisticsId: 'l_yuntu', country: 'US', zones: [{ min: 0.51, max: 1, freight: 95, registration: 20 }, { min: 1.01, max: 2, freight: 90, registration: 20 }, { min: 2.01, max: 5, freight: 85, registration: 20 }], createdAt: new Date().toISOString() },
    // 云途物流 - 澳大利亚
    { id: 'f_yt_au_1', logisticsId: 'l_yuntu', country: 'AU', zones: [{ min: 0, max: 0.5, freight: 85, registration: 40 }, { min: 0.51, max: 1, freight: 80, registration: 40 }], createdAt: new Date().toISOString() },
    { id: 'f_yt_au_2', logisticsId: 'l_yuntu', country: 'AU', zones: [{ min: 1.01, max: 2, freight: 75, registration: 40 }, { min: 2.01, max: 5, freight: 70, registration: 40 }], createdAt: new Date().toISOString() },
    // DHL - 德国
    { id: 'f_dhl_de', logisticsId: 'l_dhl', country: 'DE', zones: [{ min: 0, max: 0.5, freight: 120, registration: 50 }, { min: 0.51, max: 1, freight: 115, registration: 50 }, { min: 1.01, max: 2, freight: 110, registration: 50 }], createdAt: new Date().toISOString() },
    // DHL - 美国
    { id: 'f_dhl_us', logisticsId: 'l_dhl', country: 'US', zones: [{ min: 0, max: 0.5, freight: 150, registration: 40 }, { min: 0.51, max: 1, freight: 145, registration: 40 }, { min: 1.01, max: 2, freight: 140, registration: 40 }], createdAt: new Date().toISOString() }
  ];
  await save('freight', freight);

  toast('已初始化真实示例数据 Sample data initialized', 'ok');
}

// localStorage 降级方案
function initLocalStorageData() {
  const yuntu = { id: 'logi_yuntu', name: '云途物流', type: 'general', code: 'YT', contact: '', createdAt: new Date().toISOString() };
  localStorage.setItem(STORAGE.logistics, JSON.stringify([yuntu]));
  localStorage.setItem(STORAGE.freight, JSON.stringify([
    { id: 'f1', logisticsId: 'logi_yuntu', country: 'DE', zones: [{ min: 0, max: 2, freight: 50, registration: 30 }], createdAt: new Date().toISOString() }
  ]));
}

function showStorageHint() {
  try {
    if (sessionStorage.getItem('qms_storage_hint')) return;
    if (DATA_DIR_HANDLE) return;
    sessionStorage.setItem('qms_storage_hint', '1');
    if ('showDirectoryPicker' in window) {
      toast('数据保存在浏览器本地存储中。Data is saved in browser localStorage. Use “Switch Data Dir” to sync to a local folder instead.', 'info');
    }
  } catch (e) {
    // ignore
  }
}

// 切换数据目录
async function changeDataDirectory() {
  if (!('showDirectoryPicker' in window)) {
    toast('您的浏览器不支持文件系统API，无法切换目录 Browser does not support File System API', 'err');
    return;
  }

  if (!confirm('切换数据目录会断开当前目录连接，需要重新选择。\nSwitching directory will disconnect the current one.\n\n原有的数据文件仍然保存在之前的目录中。\nExisting data files remain in the previous directory.')) {
    return;
  }

  DATA_DIR_HANDLE = null;
  DATA_DIR_NAME = '';
  renderDataDirDisplay();
  await chooseDataDirectory();

  // 重新加载当前页面数据
  if (curPage === 'dashboard') await renderDash();
  else if (curPage === 'products') await renderProducts();
  else if (curPage === 'inquiry') await renderInquiry();
  else if (curPage === 'quote-gen') await initQuoteGen();
  else if (curPage === 'quotes') await renderQuotes();
  else if (curPage === 'logistics') await renderLogistics();
  else if (curPage === 'freight') await renderFreight();
}

// ===========================
// 用户账号管理
// ===========================

async function renderUsers() {
  const tbody = document.getElementById('users-tbody');
  const tip = document.getElementById('users-current-tip');
  if (!tbody) return;

  if (!isAdmin()) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--gray-500);">仅管理员可管理账号 Admin only</td></tr>';
    if (tip) tip.textContent = '当前账号没有账号管理权限 No permission to manage accounts';
    return;
  }

  const users = await ensureUsersSeeded();
  if (tip) tip.textContent = CURRENT_USER ? `当前登录：${CURRENT_USER.name}（${CURRENT_USER.username}）` : '';
  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--gray-500);">暂无账号 No accounts</td></tr>';
    return;
  }

  const idEsc = (id) => JSON.stringify(id).slice(1, -1);
  tbody.innerHTML = users.map(u => `<tr>
    <td><strong>${u.username}</strong></td>
    <td>${u.name || '-'}</td>
    <td>${roleLabel(u.role)}</td>
    <td>${fmtD(u.createdAt)}</td>
    <td>${CURRENT_USER && CURRENT_USER.id === u.id ? '<span class="badge badge-blue">当前账号 Current</span>' : '<span class="badge badge-gray">可登录 Active</span>'}</td>
    <td>
      <button class="btn btn-sm btn-outline" onclick="editUser('${idEsc(u.id)}')">编辑 Edit</button>
      <button class="btn btn-sm btn-danger" onclick="delUser('${idEsc(u.id)}')" style="margin-left:8px;">删除 Del</button>
    </td>
  </tr>`).join('');
}

function openAddUser() {
  if (!isAdmin()) { toast('仅管理员可添加账号 Admin only', 'err'); return; }
  document.getElementById('mo-user-title').textContent = '添加账号 Add Account';
  document.getElementById('eu-id').value = '';
  document.getElementById('u-username').value = '';
  document.getElementById('u-name').value = '';
  document.getElementById('u-role').value = 'quote';
  document.getElementById('u-password').value = '';
  document.getElementById('u-password-tip').textContent = '请设置登录密码 Set login password';
  openM('mo-user');
}

async function editUser(id) {
  if (!isAdmin()) { toast('仅管理员可编辑账号 Admin only', 'err'); return; }
  const users = await ensureUsersSeeded();
  const user = users.find(x => x.id === id);
  if (!user) { toast('未找到该账号 Account not found', 'err'); return; }
  document.getElementById('mo-user-title').textContent = '编辑账号 Edit Account';
  document.getElementById('eu-id').value = user.id;
  document.getElementById('u-username').value = user.username;
  document.getElementById('u-name').value = user.name || '';
  document.getElementById('u-role').value = user.role || 'quote';
  document.getElementById('u-password').value = '';
  document.getElementById('u-password-tip').textContent = '留空表示不修改密码 Leave blank to keep current password';
  openM('mo-user');
}

async function saveUser() {
  if (!isAdmin()) { toast('仅管理员可保存账号 Admin only', 'err'); return; }

  const id = document.getElementById('eu-id').value;
  const username = document.getElementById('u-username').value.trim();
  const name = document.getElementById('u-name').value.trim();
  const role = document.getElementById('u-role').value;
  const password = document.getElementById('u-password').value.trim();

  if (!username) { toast('请输入账号 Please enter a username', 'err'); return; }
  if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username)) { toast('账号需为 3-20 位字母、数字、下划线或中横线 Username must be 3-20 chars (letters, digits, _ or -)', 'err'); return; }
  if (!name) { toast('请输入姓名/备注 Please enter a name', 'err'); return; }
  if (!USER_ROLES[role]) { toast('请选择有效角色 Please select a valid role', 'err'); return; }
  if (!id && !password) { toast('新增账号时必须设置密码 Password required for new account', 'err'); return; }
  if (password && password.length < 6) { toast('密码至少 6 位 Password must be at least 6 characters', 'err'); return; }

  const users = await ensureUsersSeeded();
  const duplicated = users.find(u => u.username === username && u.id !== id);
  if (duplicated) { toast('该账号已存在 Username already exists', 'err'); return; }

  if (id) {
    const idx = users.findIndex(u => u.id === id);
    if (idx < 0) { toast('未找到待编辑账号 Account not found', 'err'); return; }
    const target = users[idx];
    if (target.role === 'admin' && role !== 'admin') {
      const adminCount = users.filter(u => u.role === 'admin').length;
      if (adminCount <= 1) { toast('系统至少需要保留一个管理员账号 At least one admin must remain', 'err'); return; }
    }
    users[idx] = {
      ...target,
      username,
      name,
      role,
      updatedAt: new Date().toISOString(),
      passwordHash: password ? await hashPassword(password) : target.passwordHash
    };
    await save('users', users);
    if (CURRENT_USER && CURRENT_USER.id === id) {
      syncCurrentUser(users[idx]);
      applyUserPermissions();
      if (!isAdmin() && curPage === 'users') await nav('dashboard');
    }
    toast('账号已更新 Account updated');
  } else {
    const user = {
      id: gid(),
      username,
      name,
      role,
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString()
    };
    users.push(user);
    await save('users', users);
    toast('账号已添加 Account added');
  }

  closeM('mo-user');
  await renderUsers();
}

async function delUser(id) {
  if (!isAdmin()) { toast('仅管理员可删除账号 Admin only', 'err'); return; }
  if (!confirm('确认删除该账号？Delete this account?')) return;

  const users = await ensureUsersSeeded();
  const user = users.find(u => u.id === id);
  if (!user) { toast('未找到该账号 Account not found', 'err'); return; }
  if (CURRENT_USER && CURRENT_USER.id === id) { toast('不能删除当前登录账号 Cannot delete the currently logged-in account', 'err'); return; }
  if (user.role === 'admin' && users.filter(u => u.role === 'admin').length <= 1) {
    toast('系统至少需要保留一个管理员账号 At least one admin must remain', 'err');
    return;
  }

  await save('users', users.filter(u => u.id !== id));
  await renderUsers();
  toast('账号已删除 Account deleted');
}

// ===========================
// 登录认证
// ===========================

function setLoginView(showLogin) {
  const loginPage = document.getElementById('login-page');
  const appLayout = document.querySelector('.app-layout');
  if (!loginPage || !appLayout) return;

  loginPage.style.display = showLogin ? 'flex' : 'none';
  appLayout.style.display = showLogin ? 'none' : 'flex';

  if (showLogin) loginPage.classList.remove('hidden');
  else loginPage.classList.add('hidden');
}

async function restoreSessionUser(storedUserRaw) {
  let parsed;
  try {
    parsed = JSON.parse(storedUserRaw);
  } catch (e) {
    return null;
  }

  const users = await ensureUsersSeeded();
  let matched = null;

  if (typeof parsed === 'string') {
    matched = users.find(u => u.id === parsed || u.username === parsed);
  } else if (parsed && typeof parsed === 'object') {
    if (parsed.id) matched = users.find(u => u.id === parsed.id);
    if (!matched && parsed.username) matched = users.find(u => u.username === parsed.username);
  }

  if (!matched) return null;
  syncCurrentUser(matched);
  return CURRENT_USER;
}

async function checkLogin() {
  const loginPage = document.getElementById('login-page');
  const appLayout = document.querySelector('.app-layout');
  if (!loginPage || !appLayout) return false;

  const storedUser = localStorage.getItem(LOGIN_KEY);
  if (storedUser) {
    const sessionUser = await restoreSessionUser(storedUser);
    if (sessionUser) {
      setLoginView(false);
      applyUserPermissions();
      return true;
    }
    localStorage.removeItem(LOGIN_KEY);
  }

  CURRENT_USER = null;
  setLoginView(true);
  applyUserPermissions();
  return false;
}

async function login() {
  const usernameEl = document.getElementById('login-username');
  const passwordEl = document.getElementById('login-password');
  const username = usernameEl ? usernameEl.value.trim() : '';
  const password = passwordEl ? passwordEl.value.trim() : '';

  if (!username || !password) {
    alert('请输入账号和密码\nPlease enter username and password');
    return;
  }

  const users = await ensureUsersSeeded();
  const passwordHash = await hashPassword(password);
  const user = users.find(u => u.username === username && u.passwordHash === passwordHash);
  if (!user) {
    alert('账号或密码错误\nIncorrect username or password');
    return;
  }

  syncCurrentUser(user);
  setLoginView(false);
  applyUserPermissions();

  await initData();
  renderDataDirDisplay();
  showStorageHint();
  await renderDash();
  await refreshFreightLogi();
  initFreightEvents();
  toast(`欢迎回来 Welcome back, ${user.name}！`, 'ok');
}

function logout() {
  if (!confirm('确定要退出登录吗？\nAre you sure you want to logout?')) return;

  localStorage.removeItem(LOGIN_KEY);
  CURRENT_USER = null;
  setLoginView(true);
  applyUserPermissions();

  const usernameEl = document.getElementById('login-username');
  const passwordEl = document.getElementById('login-password');
  if (usernameEl) usernameEl.value = '';
  if (passwordEl) passwordEl.value = '';
}

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', async () => {
  await restoreDataDirectory();
  await ensureUsersSeeded();

  const isLoggedIn = await checkLogin();
  if (isLoggedIn) {
    await initData();
    renderDataDirDisplay();
    showStorageHint();
    await renderDash();
    await refreshFreightLogi();
    initFreightEvents();
  }
});
