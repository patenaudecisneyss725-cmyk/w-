const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

// Railway 使用 /app 作为工作目录
const isRailway = process.env.RAILWAY_ENVIRONMENT !== undefined;
const BASE_DIR = isRailway ? '/app' : __dirname;

const app = express();
const PORT = process.env.PORT || 3000;

// 数据文件路径
const DATA_DIR = path.join(BASE_DIR, 'database');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const QRCODES_FILE = path.join(DATA_DIR, 'qrcodes.json');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');

// 确保目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 初始化数据
function loadOrders() {
  try {
    if (fs.existsSync(ORDERS_FILE)) {
      return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('加载订单失败:', e);
  }
  return [];
}

function saveOrders(orders) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

function loadQrcodes() {
  try {
    if (fs.existsSync(QRCODES_FILE)) {
      return JSON.parse(fs.readFileSync(QRCODES_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('加载收款码失败:', e);
  }
  return [];
}

function saveQrcodes(qrcodes) {
  fs.writeFileSync(QRCODES_FILE, JSON.stringify(qrcodes, null, 2));
}

function loadProducts() {
  try {
    if (fs.existsSync(PRODUCTS_FILE)) {
      return JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('加载商品失败:', e);
  }
  return [];
}

function saveProducts(products) {
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
}

// 配置文件
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('加载配置失败:', e);
  }
  return { payment_message: '付款成功后请留意短信/邮箱通知' };
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// 初始化数据文件
if (!fs.existsSync(ORDERS_FILE)) saveOrders([]);
if (!fs.existsSync(QRCODES_FILE)) saveQrcodes([]);
if (!fs.existsSync(PRODUCTS_FILE)) saveProducts([{
  id: '1',
  name: '默认商品',
  description: '这是一个示例商品',
  price: 10,
  images: ['/uploads/product.jpg'],
  created_at: Date.now()
}]);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(BASE_DIR, 'public')));
app.use('/uploads', express.static(path.join(BASE_DIR, 'uploads')));

// 首页路由
app.get('/', (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'public', 'index.html'));
});

// 文件上传配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(BASE_DIR, 'uploads/'));
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// ============ API 路由 ============

// 获取所有活跃的收款码
app.get('/api/qrcodes', (req, res) => {
  let qrcodes = loadQrcodes().filter(q => q.isActive !== false);
  
  // 按类型过滤
  const type = req.query.type;
  if (type) {
    qrcodes = qrcodes.filter(q => q.type === type);
  }
  
  res.json(qrcodes);
});

// 上传收款码
app.post('/api/qrcodes', upload.single('qrcode'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '请上传文件' });
  }
  
  const qrcodes = loadQrcodes();
  const newQr = {
    id: Date.now(),
    filename: req.file.filename,
    uploadTime: Date.now(),
    isActive: true
  };
  qrcodes.push(newQr);
  saveQrcodes(qrcodes);
  
  res.json({ 
    success: true, 
    id: newQr.id,
    filename: req.file.filename 
  });
});

// 删除收款码
app.delete('/api/qrcodes/:id', (req, res) => {
  let qrcodes = loadQrcodes();
  qrcodes = qrcodes.map(q => {
    if (q.id == req.params.id) {
      q.isActive = false;
    }
    return q;
  });
  saveQrcodes(qrcodes);
  res.json({ success: true });
});

// 创建订单
app.post('/api/orders', (req, res) => {
  const { customer_name, customer_address, customer_phone, amount } = req.body;
  
  if (!customer_name || !customer_address || !customer_phone) {
    return res.status(400).json({ error: '请填写完整信息' });
  }
  
  const qrcodes = loadQrcodes().filter(q => q.isActive !== false);
  if (qrcodes.length === 0) {
    return res.status(500).json({ error: '暂无可用收款码' });
  }
  
  const orderId = uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase();
  const now = Date.now();
  const expiresAt = now + 20 * 60 * 1000; // 20 分钟后过期
  const qrIndex = Math.floor(Math.random() * qrcodes.length);
  
  const orders = loadOrders();
  orders.push({
    id: orderId,
    customer_name,
    customer_address,
    customer_phone,
    amount: amount || 0,
    qr_index: qrIndex,
    status: 'pending', // pending, paid, shipped, delivered
    shipping_company: '', // 快递公司
    tracking_number: '', // 快递单号
    shipped_at: null,
    created_at: now,
    expires_at: expiresAt
  });
  saveOrders(orders);
  
  res.json({
    success: true,
    order: {
      id: orderId,
      qr_index: qrIndex,
      expires_at: expiresAt,
      total_qrcodes: qrcodes.length
    }
  });
});

// 用户登录（手机号验证）
app.post('/api/login', (req, res) => {
  const { phone } = req.body;
  
  if (!phone) {
    return res.status(400).json({ error: '请输入手机号' });
  }
  
  const orders = loadOrders();
  const userOrders = orders.filter(o => o.customer_phone === phone);
  
  if (userOrders.length === 0) {
    return res.status(404).json({ error: '未找到该手机号的订单' });
  }
  
  res.json({
    success: true,
    phone,
    orders: userOrders.sort((a, b) => b.created_at - a.created_at)
  });
});

// 获取订单信息
app.get('/api/orders/:id', (req, res) => {
  const orders = loadOrders();
  const order = orders.find(o => o.id === req.params.id);
  if (!order) {
    return res.status(404).json({ error: '订单不存在' });
  }
  res.json(order);
});

// 标记订单为已支付
app.post('/api/orders/:id/paid', (req, res) => {
  let orders = loadOrders();
  orders = orders.map(o => {
    if (o.id === req.params.id) {
      o.status = 'paid';
    }
    return o;
  });
  saveOrders(orders);
  res.json({ success: true });
});

// 后台发货
app.post('/api/admin/orders/:id/ship', (req, res) => {
  const { shipping_company, tracking_number } = req.body;
  
  if (!shipping_company || !tracking_number) {
    return res.status(400).json({ error: '请填写快递公司和单号' });
  }
  
  let orders = loadOrders();
  const orderIndex = orders.findIndex(o => o.id === req.params.id);
  
  if (orderIndex === -1) {
    return res.status(404).json({ error: '订单不存在' });
  }
  
  orders[orderIndex].status = 'shipped';
  orders[orderIndex].shipping_company = shipping_company;
  orders[orderIndex].tracking_number = tracking_number;
  orders[orderIndex].shipped_at = Date.now();
  
  saveOrders(orders);
  res.json({ success: true });
});

// 标记订单为已送达
app.post('/api/admin/orders/:id/delivered', (req, res) => {
  let orders = loadOrders();
  orders = orders.map(o => {
    if (o.id === req.params.id) {
      o.status = 'delivered';
    }
    return o;
  });
  saveOrders(orders);
  res.json({ success: true });
});

// 修改订单价格
app.post('/api/admin/orders/:id/price', (req, res) => {
  const { amount } = req.body;
  
  if (amount === undefined || isNaN(amount) || amount < 0) {
    return res.status(400).json({ error: '请输入有效的金额' });
  }
  
  let orders = loadOrders();
  const orderIndex = orders.findIndex(o => o.id === req.params.id);
  
  if (orderIndex === -1) {
    return res.status(404).json({ error: '订单不存在' });
  }
  
  orders[orderIndex].amount = parseFloat(amount);
  orders[orderIndex].total_amount = parseFloat(amount);
  
  saveOrders(orders);
  res.json({ success: true });
});

// 保存订单备注
app.post('/api/admin/orders/:id/note', (req, res) => {
  const { note } = req.body;
  
  let orders = loadOrders();
  const orderIndex = orders.findIndex(o => o.id === req.params.id);
  
  if (orderIndex === -1) {
    return res.status(404).json({ error: '订单不存在' });
  }
  
  orders[orderIndex].note = note || '';
  saveOrders(orders);
  res.json({ success: true });
});

// 删除订单
app.delete('/api/admin/orders/:id', (req, res) => {
  let orders = loadOrders();
  const orderIndex = orders.findIndex(o => o.id === req.params.id);
  
  if (orderIndex === -1) {
    return res.status(404).json({ error: '订单不存在' });
  }
  
  orders.splice(orderIndex, 1);
  saveOrders(orders);
  res.json({ success: true });
});

// 获取所有订单（后台）
app.get('/api/admin/orders', (req, res) => {
  const orders = loadOrders();
  res.json(orders.sort((a, b) => b.created_at - a.created_at));
});

// 导出订单为 CSV
app.get('/api/admin/orders/export', (req, res) => {
  const orders = loadOrders().sort((a, b) => b.created_at - a.created_at);
  
  let csv = '订单号，姓名，地址，手机，金额，快递公司，单号，状态，创建时间\n';
  orders.forEach(order => {
    csv += `${order.id},${order.customer_name},${order.customer_address},${order.customer_phone},${order.amount},${order.shipping_company},${order.tracking_number},${order.status},${new Date(order.created_at).toLocaleString('zh-CN')}\n`;
  });
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=orders.csv');
  res.send(csv);
});

// ============ 商品管理 API ============

// 获取所有商品
app.get('/api/admin/products', (req, res) => {
  const products = loadProducts();
  res.json(products.sort((a, b) => b.created_at - a.created_at));
});

// 添加商品
app.post('/api/admin/products', upload.single('image'), (req, res) => {
  const { name, price, description } = req.body;
  
  if (!name || !price) {
    return res.status(400).json({ error: '请填写商品名称和价格' });
  }
  
  const products = loadProducts();
  const newProduct = {
    id: Date.now().toString(),
    name,
    price: parseFloat(price),
    description: description || '',
    images: req.file ? ['/uploads/' + req.file.filename] : [],
    created_at: Date.now()
  };
  
  products.push(newProduct);
  saveProducts(products);
  
  res.json({ success: true, product: newProduct });
});

// 更新商品
app.put('/api/admin/products/:id', upload.single('image'), (req, res) => {
  const { name, price, description } = req.body;
  const products = loadProducts();
  const index = products.findIndex(p => p.id === req.params.id);
  
  if (index === -1) {
    return res.status(404).json({ error: '商品不存在' });
  }
  
  if (name) products[index].name = name;
  if (price) products[index].price = parseFloat(price);
  if (description !== undefined) products[index].description = description;
  if (req.file) {
    products[index].images = ['/uploads/' + req.file.filename];
  }
  
  saveProducts(products);
  res.json({ success: true, product: products[index] });
});

// 删除商品
app.delete('/api/admin/products/:id', (req, res) => {
  let products = loadProducts();
  products = products.filter(p => p.id !== req.params.id);
  saveProducts(products);
  res.json({ success: true });
});

// ============ 配置 API ============

// 获取支付页面文案
app.get('/api/config/payment_message', (req, res) => {
  const config = loadConfig();
  res.json({ message: config.payment_message || '付款成功后请留意短信/邮箱通知' });
});

// 更新支付页面文案
app.post('/api/admin/config/payment_message', (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: '请输入文案' });
  }
  
  const config = loadConfig();
  config.payment_message = message;
  saveConfig(config);
  
  res.json({ success: true });
});

// 获取首页底部文案
app.get('/api/config/footer_message', (req, res) => {
  const config = loadConfig();
  res.json({ message: config.footer_message || '© 2026 发卡商城' });
});

// 更新首页底部文案
app.post('/api/admin/config/footer_message', (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: '请输入文案' });
  }
  
  const config = loadConfig();
  config.footer_message = message;
  saveConfig(config);
  
  res.json({ success: true });
});

// 获取商品展示模式
app.get('/api/config/display_mode', (req, res) => {
  const config = loadConfig();
  res.json({ mode: config.display_mode || 'grid' });
});

// 更新商品展示模式
app.post('/api/admin/config/display_mode', (req, res) => {
  const { mode } = req.body;
  if (!mode) {
    return res.status(400).json({ error: '请选择展示模式' });
  }
  
  const config = loadConfig();
  config.display_mode = mode;
  saveConfig(config);
  
  res.json({ success: true });
});

// ============ 简化版商城 API ============

// 获取商品
app.get('/api/products', (req, res) => {
  const products = loadProducts();
  if (products.length === 0) {
    // 如果没有商品，返回默认
    res.json([{
      id: '1',
      name: '商品',
      description: '请在后台添加商品',
      price: 10,
      images: []
    }]);
  } else {
    res.json(products);
  }
});

// 简化版订单查询（支持订单号和手机号）
app.get('/api/orders/query', (req, res) => {
  const { orderId, phone } = req.query;
  const orders = loadOrders();
  
  let results = [];
  if (orderId) {
    const order = orders.find(o => o.id === orderId);
    if (order) results.push(order);
  } else if (phone) {
    results = orders.filter(o => o.customer_phone === phone);
  }
  
  res.json(results.sort((a, b) => b.created_at - a.created_at));
});

// 简化版创建订单
app.post('/api/orders', (req, res) => {
  const { customer_name, customer_address, customer_phone, product_id, payment_method } = req.body;
  
  if (!customer_name || !customer_address || !customer_phone) {
    return res.status(400).json({ error: '请填写完整信息' });
  }
  
  // 获取商品
  const products = loadProducts();
  let product;
  
  if (product_id) {
    // 按ID查找商品
    product = products.find(p => p.id === product_id);
  }
  
  // 如果没找到商品，使用第一个
  if (!product) {
    product = products.length > 0 ? products[0] : { id: '1', name: '商品', price: 10 };
  }
  
  const orderAmount = product.price;
  
  const orderId = uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase();
  const now = Date.now();
  const expiresAt = now + 5 * 60 * 1000; // 5分钟过期
  
  const orders = loadOrders();
  orders.push({
    id: orderId,
    customer_name,
    customer_address,
    customer_phone,
    payment_method: payment_method || 'wechat',
    amount: orderAmount,
    total_amount: orderAmount,
    status: 'pending',
    shipping_company: '',
    tracking_number: '',
    shipped_at: null,
    created_at: now,
    expires_at: expiresAt,
    products: [{ ...product, quantity: 1 }]
  });
  saveOrders(orders);
  
  res.json({
    success: true,
    order: {
      id: orderId,
      total_amount: orderAmount,
      expires_at: expiresAt
    }
  });
});

// ============ 后台管理 API ============

// 管理员登录（简化版，账号密码硬编码）
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin123';

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = Buffer.from(`${username}:${Date.now()}`).toString('base64');
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, error: '账号或密码错误' });
  }
});

// 获取所有收款码（带类型）
app.get('/api/admin/qrcodes', (req, res) => {
  const qrcodes = loadQrcodes().filter(q => q.isActive !== false);
  // 为每个二维码添加类型（简单处理，按上传顺序分配）
  const result = qrcodes.map((q, i) => ({
    ...q,
    type: i === 0 ? 'wechat' : 'alipay'
  }));
  res.json(result);
});

// 上传收款码（支持类型）
app.post('/api/admin/qrcode', upload.single('qrcode'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '请上传文件' });
  }
  
  const type = req.body.type || 'wechat';
  
  // 停用该类型的旧二维码
  let qrcodes = loadQrcodes();
  qrcodes = qrcodes.map(q => {
    if (q.type === type) {
      q.isActive = false;
    }
    return q;
  });
  
  const newQr = {
    id: Date.now(),
    filename: req.file.filename,
    uploadTime: Date.now(),
    isActive: true,
    type: type
  };
  qrcodes.push(newQr);
  saveQrcodes(qrcodes);
  
  res.json({ success: true, qrcode: newQr });
});

// 删除收款码（按类型）
app.delete('/api/admin/qrcode/:type', (req, res) => {
  const type = req.params.type;
  let qrcodes = loadQrcodes();
  
  // 停用对应类型的二维码
  qrcodes = qrcodes.map(q => {
    if (q.type === type) {
      q.isActive = false;
    }
    return q;
  });
  
  saveQrcodes(qrcodes);
  res.json({ success: true });
});

// 确认支付
app.post('/api/admin/orders/:id/confirm', (req, res) => {
  let orders = loadOrders();
  let found = false;
  orders = orders.map(o => {
    if (o.id === req.params.id && o.status === 'pending') {
      o.status = 'paid';
      found = true;
    }
    return o;
  });
  
  if (found) {
    saveOrders(orders);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: '订单不存在或状态异常' });
  }
});

// 获取订单（简化版，兼容前端）
app.get('/api/orders/:id', (req, res) => {
  const orders = loadOrders();
  const order = orders.find(o => o.id === req.params.id);
  if (!order) {
    return res.status(404).json({ error: '订单不存在' });
  }
  res.json(order);
});

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
  console.log(`服务器运行在 http://0.0.0.0:${PORT}`);
  console.log(`用户商城：http://localhost:${PORT}/`);
  console.log(`后台管理：http://localhost:${PORT}/admin/login.html`);
});
