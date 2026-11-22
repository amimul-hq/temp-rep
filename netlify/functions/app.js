import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import axios from 'axios';
import { v2 as cloudinary } from 'cloudinary';

import {
  connectToDatabase,
  localJsonStore,
  defaultWebsiteConfig,
  defaultCategories,
  defaultProducts,
  defaultWebsiteData
} from './db.js';

import { sendMetaCapiEvent, retryMetaCapiEvent, extractClientIp } from './utils/metaCapi.js';
import { sendOrderToMongoDB, connectMongoOrders } from './mongoOrders.js';

dotenv.config();

// Pre-warm MongoDB order connection in background if URI is present
connectMongoOrders().catch(() => {});

const app = express();

// Configure Cloudinary if credentials are provided
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// URL Rewriter: Ensures routes work seamlessly both locally and under Netlify Functions redirect
app.use((req, res, next) => {
  if (req.url.startsWith('/.netlify/functions/api')) {
    req.url = req.url.slice('/.netlify/functions/api'.length) || '/';
  }
  if (!req.url.startsWith('/api')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  next();
});

const JWT_SECRET = process.env.JWT_SECRET;

// Helper: Sanitize public website data - ensure sensitive server credentials/tokens are never exposed
function sanitizePublicWebsiteData(doc) {
  if (!doc) return null;
  const obj = JSON.parse(JSON.stringify(doc));
  if (obj.metaSettings) {
    delete obj.metaSettings.capiAccessToken;
  }
  // Do not expose internal admin records or full customer orders in public site payload
  delete obj.admins;
  delete obj.orders;
  delete obj.metaEventLogs;
  return obj;
}

// Admin Auth Middleware
function generateOrderId() {
  const now = new Date();
  const datePrefix = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `HAIR-${datePrefix}-${randomSuffix}`;
}

const requireAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Authentication required. Please login as admin.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session. Please login again.' });
  }
};

// =========================================================================
// 1. PUBLIC ROUTES
// =========================================================================

// Health check / API status
app.get('/api/health', async (req, res) => {
  const dbStatus = await connectToDatabase();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    databaseMode: dbStatus.mode,
    storageFile: dbStatus.filePath,
    version: '1.0.0'
  });
});

// GET /api/website-data - Retrieve complete consolidated public website dataset in ONE request from local JSON
app.get('/api/website-data', async (req, res) => {
  try {
    const websiteData = await localJsonStore.getWebsiteData();
    const version = websiteData.version || 1;
    const updatedAtTime = new Date(websiteData.updatedAt || Date.now()).getTime();
    const etag = `W/"${version}-${updatedAtTime}"`;

    res.set({
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60, s-maxage=120, stale-while-revalidate=300',
      'ETag': etag
    });

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    const sanitized = sanitizePublicWebsiteData(websiteData);
    if (!sanitized.metaSettings) sanitized.metaSettings = {};
    sanitized.metaSettings.pixelId = process.env.META_PIXEL_ID || '';

    return res.json({
      success: true,
      version,
      updatedAt: websiteData.updatedAt,
      data: sanitized
    });
  } catch (err) {
    console.error('Error fetching centralized website data:', err);
    return res.json({
      success: true,
      version: 1,
      data: sanitizePublicWebsiteData(defaultWebsiteData)
    });
  }
});

// GET /api/site-config - Retrieve full website configuration for public rendering (backed by local JSON)
app.get('/api/site-config', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=300');
    const websiteData = await localJsonStore.getWebsiteConfig();
    const sanitized = sanitizePublicWebsiteData(websiteData);
    if (!sanitized.metaSettings) sanitized.metaSettings = {};
    sanitized.metaSettings.pixelId = process.env.META_PIXEL_ID || '';
    return res.json({ success: true, data: sanitized });
  } catch (err) {
    console.error('Error fetching site config:', err);
    return res.json({ success: true, data: sanitizePublicWebsiteData(defaultWebsiteData) });
  }
});

// GET /api/categories - Retrieve active product categories (backed by local JSON)
app.get('/api/categories', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=300');
    const categories = await localJsonStore.getCategories();
    const active = categories
      .filter(c => c.isActive !== false)
      .sort((a, b) => (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0));
    return res.json({ success: true, data: active });
  } catch (err) {
    console.error('Error fetching categories:', err);
    return res.json({ success: true, data: defaultCategories });
  }
});

// GET /api/products - Retrieve products with search, category filtering & sorting (backed by local JSON)
app.get('/api/products', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=300');
    const { category, search, featured, sort } = req.query;
    let allProducts = await localJsonStore.getProducts();

    let filtered = allProducts.filter(p => p.isActive !== false);

    if (category && category !== 'All Products' && category !== 'All') {
      filtered = filtered.filter(p => p.category && p.category.toLowerCase() === category.toLowerCase());
    }
    if (featured === 'true') {
      filtered = filtered.filter(p => p.isFeatured);
    }
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(p =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.title && p.title.toLowerCase().includes(q)) ||
        (p.shortDescription && p.shortDescription.toLowerCase().includes(q))
      );
    }

    if (sort === 'price-low') filtered.sort((a, b) => a.salePrice - b.salePrice);
    else if (sort === 'price-high') filtered.sort((a, b) => b.salePrice - a.salePrice);
    else if (sort === 'newest') filtered.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    else filtered.sort((a, b) => (a.carouselOrder || 0) - (b.carouselOrder || 0));

    return res.json({ success: true, data: filtered, count: filtered.length });
  } catch (err) {
    console.error('Error fetching products:', err);
    return res.json({ success: true, data: defaultProducts, count: defaultProducts.length });
  }
});

// GET /api/products/:slug - Retrieve single product details (backed by local JSON)
app.get('/api/products/:slug', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=300');
    const { slug } = req.params;
    const product = await localJsonStore.getProductBySlug(slug);

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    return res.json({ success: true, data: product });
  } catch (err) {
    console.error('Error fetching product by slug:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch product' });
  }
});

// POST /api/orders - Public Order Creation with Server-Side Price & Stock Verification against local JSON
app.post('/api/orders', async (req, res) => {
  try {
    const { customer, items, attribution, metaEventId } = req.body;

    if (!customer || !customer.fullName || !customer.phoneNumber || !customer.address || !customer.deliveryArea) {
      return res.status(400).json({
        success: false,
        message: 'Please complete all required customer information (Name, Phone, Delivery Area, Address).'
      });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Your shopping cart is empty.'
      });
    }

    // 1. Fetch current delivery fee settings & product stock from centralized local JSON
    const websiteData = await localJsonStore.getWebsiteData();
    const deliverySettings = websiteData.deliverySettings || defaultWebsiteConfig.deliverySettings;
    const siteMeta = websiteData.metaSettings || defaultWebsiteConfig.metaSettings;
    const availableProducts = websiteData.products || [];

    const deliveryFee = customer.deliveryArea === 'inside_dhaka'
      ? (deliverySettings.insideDhakaFee ?? 70)
      : (deliverySettings.outsideDhakaFee ?? 130);

    // 2. Fetch official product details from local JSON and calculate verified subtotal
    let verifiedItems = [];
    let calculatedSubtotal = 0;

    for (const item of items) {
      const productDoc = availableProducts.find(p =>
        (item.slug && p.slug === item.slug) ||
        (item.productId && (String(p._id) === String(item.productId) || p.slug === item.productId))
      );

      if (!productDoc) {
        return res.status(400).json({
          success: false,
          message: `Product "${item.productName || item.productId}" is currently unavailable.`
        });
      }

      const requestedQty = Math.max(1, parseInt(item.quantity) || 1);
      const verifiedUnitPrice = productDoc.salePrice;
      const itemTotal = verifiedUnitPrice * requestedQty;
      calculatedSubtotal += itemTotal;

      const resolvedName = productDoc.name || productDoc.title || item.productName || 'Product';
      const resolvedSlug = productDoc.slug || item.slug || resolvedName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const resolvedCategory = productDoc.category || item.category || 'Hair Care';

      verifiedItems.push({
        productId: String(productDoc._id || resolvedSlug),
        productName: resolvedName,
        slug: resolvedSlug,
        category: resolvedCategory,
        image: productDoc.images?.[0] || '',
        unitPrice: verifiedUnitPrice,
        quantity: requestedQty,
        itemTotal: itemTotal
      });

      // Safely decrement stock in local store
      await localJsonStore.decrementStock(productDoc.slug || productDoc._id, requestedQty);
    }

    const discount = 0;
    const finalTotal = calculatedSubtotal + deliveryFee - discount;

    // 3. Generate unique memorable order ID (e.g. HAIR-2611-X48A)
    const datePrefix = new Date().toISOString().slice(2, 7).replace('-', '');
    const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const orderId = `HAIR-${datePrefix}-${randomSuffix}`;

    const orderPayload = {
      orderId,
      orderNumber: orderId,
      customer: {
        fullName: customer.fullName.trim(),
        phoneNumber: customer.phoneNumber.trim(),
        district: customer.district ? customer.district.trim() : (customer.deliveryArea === 'inside_dhaka' ? 'Dhaka' : 'Outside Dhaka'),
        deliveryArea: customer.deliveryArea,
        address: customer.address.trim(),
        notes: customer.notes || ''
      },
      items: verifiedItems,
      subtotal: calculatedSubtotal,
      discount: discount,
      deliveryCharge: deliveryFee,
      finalTotal: finalTotal,
      paymentMethod: 'COD',
      orderStatus: 'Pending',
      statusHistory: [
        {
          status: 'Pending',
          timestamp: new Date().toISOString(),
          note: 'Order placed by customer via Cash on Delivery',
          updatedBy: 'System'
        }
      ],
      attribution: {
        fbp: (attribution?.fbp && typeof attribution.fbp === 'string' && attribution.fbp.startsWith('fb.')) ? attribution.fbp.trim() : '',
        fbc: (attribution?.fbc && typeof attribution.fbc === 'string' && attribution.fbc.startsWith('fb.')) ? attribution.fbc.trim() : '',
        fbcSource: attribution?.fbcSource || (attribution?.fbc ? 'fbc_cookie' : 'none'),
        fbclid: attribution?.fbclid || '',
        utmSource: attribution?.utmSource || '',
        utmMedium: attribution?.utmMedium || '',
        utmCampaign: attribution?.utmCampaign || '',
        utmContent: attribution?.utmContent || '',
        utmTerm: attribution?.utmTerm || '',
        landingPage: attribution?.landingPage || '',
        referrer: attribution?.referrer || '',
        userAgent: req.headers['user-agent'] || '',
        ip: extractClientIp(req)
      },
      metaEventId: metaEventId || `order_${orderId}`
    };

    const createdOrder = await localJsonStore.addOrder(orderPayload);

    // 3b. Mirror order details to MongoDB collection (fault-tolerant & resilient)
    try {
      await sendOrderToMongoDB(createdOrder);
    } catch (mongoErr) {
      console.warn('[MongoDB Orders] Background order sync notice:', mongoErr.message);
    }

    // 4. Trigger Server-Side Meta Conversions API (CAPI) Purchase Event
    const isCapiActive = siteMeta?.isCapiEnabled !== false;
    if (isCapiActive) {
      sendMetaCapiEvent({
        pixelId: process.env.META_PIXEL_ID,
        accessToken: process.env.META_CAPI_ACCESS_TOKEN,
        testEventCode: siteMeta?.testEventCode || process.env.META_TEST_EVENT_CODE,
        isLoggingEnabled: siteMeta?.isLoggingEnabled !== false,
        logRetentionDays: siteMeta?.logRetentionDays || 7,
        eventName: 'Purchase',
        eventId: orderPayload.metaEventId,
        orderId: orderId,
        eventSource: 'server_order',
        eventSourceUrl: attribution?.landingPage || req.headers['referer'] || '',
        userData: {
          phone: customer.phoneNumber,
          firstName: customer.fullName.split(' ')[0],
          lastName: customer.fullName.split(' ').slice(1).join(' ') || '',
          city: orderPayload.customer.district,
          clientIpAddress: orderPayload.attribution.ip,
          clientUserAgent: orderPayload.attribution.userAgent,
          fbp: orderPayload.attribution.fbp || undefined,
          fbc: orderPayload.attribution.fbc || undefined,
          fbcSource: orderPayload.attribution.fbcSource
        },
        customData: {
          currency: 'BDT',
          value: finalTotal,
          order_id: orderId,
          content_name: 'Order Purchase',
          content_type: 'product',
          content_category: ([...new Set(verifiedItems.map(i => i.category).filter(Boolean))].join(', ') || 'Hair Care'),
          content_categories: [...new Set(verifiedItems.map(i => i.category).filter(Boolean))],
          contents: verifiedItems.map(i => ({
            id: i.productId || i.slug,
            quantity: i.quantity,
            item_price: i.unitPrice,
            category: i.category || 'Hair Care'
          })),
          num_items: verifiedItems.reduce((acc, i) => acc + i.quantity, 0)
        },
        req
      }).catch(err => console.warn('Background CAPI Purchase error:', err.message));
    }

    return res.status(201).json({
      success: true,
      message: 'Order placed successfully!',
      orderId: orderId,
      data: createdOrder
    });
  } catch (err) {
    console.error('Error placing order:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to place order. Please try again or contact support.'
    });
  }
});

// GET /api/orders/:orderId - Retrieve order summary for confirmation & status page
app.get('/api/orders/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await localJsonStore.getOrderById(orderId);

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    return res.json({ success: true, data: order });
  } catch (err) {
    console.error('Error fetching order by ID:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch order details' });
  }
});

// POST /api/meta/events - Dual dispatch endpoint for CAPI event forwarding from browser
app.post('/api/meta/events', async (req, res) => {
  try {
    const { eventName, eventId, eventSourceUrl, userData, customData } = req.body;

    if (!eventName || !eventId) {
      return res.status(400).json({ success: false, message: 'eventName and eventId are required' });
    }

    // Deduplication guard: Purchase events are dispatched directly by the server order creation.
    if (eventName === 'Purchase') {
      return res.json({ success: true, message: 'Purchase event already handled on server order creation' });
    }

    const cfg = await localJsonStore.getWebsiteConfig();
    const siteMeta = cfg?.metaSettings || defaultWebsiteConfig.metaSettings;

    if (siteMeta?.isCapiEnabled === false) {
      return res.json({ success: true, message: 'CAPI is disabled in settings' });
    }

    const result = await sendMetaCapiEvent({
      pixelId: process.env.META_PIXEL_ID,
      accessToken: process.env.META_CAPI_ACCESS_TOKEN,
      testEventCode: siteMeta?.testEventCode || process.env.META_TEST_EVENT_CODE,
      isLoggingEnabled: siteMeta?.isLoggingEnabled !== false,
      logRetentionDays: siteMeta?.logRetentionDays || 7,
      eventName,
      eventId,
      eventSource: 'browser_forwarded',
      eventSourceUrl,
      orderId: customData?.order_id || '',
      userData: userData || {},
      customData: customData || {},
      req
    });

    return res.json({ success: true, capiResult: result });
  } catch (err) {
    console.error('Error in meta events endpoint:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =========================================================================
// 2. ADMIN AUTHENTICATION & DASHBOARD
// =========================================================================

// POST /api/admin/login
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password required' });
    }

    if (!JWT_SECRET) {
      return res.status(503).json({ success: false, message: 'Admin authentication is not configured.' });
    }

    const cleanUser = String(username).trim().toLowerCase();
    const cleanPass = String(password).trim();

    const envUser = (process.env.ADMIN_USERNAME || '').trim().toLowerCase();
    const envPass = (process.env.ADMIN_PASSWORD || '').trim();

    const adminRecord = await localJsonStore.getAdminByUsername(cleanUser);
    let isMatch = false;

    if (adminRecord && adminRecord.password) {
      if (adminRecord.password.startsWith('$2')) {
        isMatch = await bcrypt.compare(cleanPass, adminRecord.password);
      } else {
        isMatch = (cleanPass === adminRecord.password);
      }
    }

    // Direct fallback: If DB hash failed or doesn't match, verify against ENV credentials
    if (!isMatch && envUser && envPass && cleanUser === envUser && cleanPass === envPass) {
      isMatch = true;
    }

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
    }

    const adminId = adminRecord?._id || 'admin_1';
    const adminRole = adminRecord?.role || 'superadmin';

    const token = jwt.sign(
      { id: adminId, username: adminRecord?.username || envUser, role: adminRole },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      message: 'Login successful',
      token,
      admin: {
        id: adminId,
        username: adminRecord?.username || envUser,
        name: adminRecord?.name || 'Store Administrator',
        role: adminRole
      }
    });
  } catch (err) {
    console.error('Admin login error:', err);
    return res.status(500).json({ success: false, message: 'Authentication server error' });
  }
});

// GET /api/admin/me
app.get('/api/admin/me', requireAdmin, async (req, res) => {
  res.json({ success: true, admin: req.admin });
});

// GET /api/admin/dashboard - Comprehensive Analytics & KPIs
app.get('/api/admin/dashboard', requireAdmin, async (req, res) => {
  try {
    const orders = await localJsonStore.getOrders();
    const products = await localJsonStore.getProducts();

    const totalOrders = orders.length;
    const pendingOrders = orders.filter(o => o.orderStatus === 'Pending').length;
    const confirmedOrders = orders.filter(o => o.orderStatus === 'Confirmed' || o.orderStatus === 'Processing').length;
    const deliveredOrders = orders.filter(o => o.orderStatus === 'Delivered').length;
    const cancelledOrders = orders.filter(o => o.orderStatus === 'Cancelled' || o.orderStatus === 'Rejected').length;

    // Calculate revenue from non-cancelled orders
    const totalRevenue = orders
      .filter(o => o.orderStatus !== 'Cancelled' && o.orderStatus !== 'Rejected')
      .reduce((sum, o) => sum + (o.finalTotal || 0), 0);

    // Calculate best selling products
    const productSalesMap = {};
    orders.forEach(o => {
      if (o.orderStatus !== 'Cancelled' && o.orderStatus !== 'Rejected') {
        (o.items || []).forEach(item => {
          const key = item.productName;
          productSalesMap[key] = (productSalesMap[key] || 0) + (item.quantity || 1);
        });
      }
    });

    const topSelling = Object.entries(productSalesMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return res.json({
      success: true,
      data: {
        stats: {
          totalOrders,
          pendingOrders,
          confirmedOrders,
          deliveredOrders,
          cancelledOrders,
          totalRevenue,
          totalProducts: products.length
        },
        topSelling,
        recentOrders: orders.slice(0, 8),
        databaseMode: 'local_json'
      }
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    return res.status(500).json({ success: false, message: 'Failed to calculate dashboard statistics' });
  }
});

// =========================================================================
// 3. ADMIN PRODUCT MANAGEMENT (Backed by local JSON store)
// =========================================================================

app.get('/api/admin/products', requireAdmin, async (req, res) => {
  try {
    const products = await localJsonStore.getProducts();
    products.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return res.json({ success: true, data: products });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/admin/products', requireAdmin, async (req, res) => {
  try {
    const { name, slug, regularPrice, salePrice, category, stock, shortDescription, description, images, isFeatured, isActive, productType, comboItems, badge, keyBenefits, specifications, displayOrder } = req.body;

    if (!name || !regularPrice || !salePrice || !category) {
      return res.status(400).json({ success: false, message: 'Name, Category, Regular Price, and Sale Price are required' });
    }

    const generatedSlug = slug
      ? slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
      : name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const newProductId = `prod_${Date.now()}`;
    const productPayload = {
      _id: newProductId,
      name: name.trim(),
      title: name.trim(),
      slug: generatedSlug || `product-${Date.now()}`,
      shortDescription: shortDescription || '',
      description: description || '',
      images: Array.isArray(images) ? images : [],
      category: category.trim(),
      regularPrice: Number(regularPrice),
      salePrice: Number(salePrice),
      stock: Number(stock || 0),
      isFeatured: Boolean(isFeatured),
      isActive: isActive !== false,
      productType: productType || 'minoxidil',
      comboItems: Array.isArray(comboItems) ? comboItems : [],
      badge: badge || '',
      keyBenefits: Array.isArray(keyBenefits) ? keyBenefits : [],
      specifications: Array.isArray(specifications) ? specifications : [],
      displayOrder: Number(displayOrder || 0),
      carouselOrder: Number(displayOrder || 0),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const created = await localJsonStore.addProduct(productPayload);
    return res.status(201).json({ success: true, message: 'Product created successfully', data: created });
  } catch (err) {
    console.error('Error creating product:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/admin/products/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    delete updateData._id;

    if (updateData.slug) {
      updateData.slug = updateData.slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    }

    if (updateData.displayOrder !== undefined) {
      updateData.displayOrder = Number(updateData.displayOrder || 0);
      updateData.carouselOrder = updateData.displayOrder;
    }

    const updated = await localJsonStore.updateProduct(id, updateData);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    return res.json({ success: true, message: 'Product updated successfully', data: updated });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await localJsonStore.deleteProduct(id);
    return res.json({ success: true, message: 'Product deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// =========================================================================
// 4. ADMIN CATEGORY MANAGEMENT (Backed by local JSON store)
// =========================================================================

app.get('/api/admin/categories', requireAdmin, async (req, res) => {
  try {
    const categories = await localJsonStore.getCategories();
    categories.sort((a, b) => (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0));
    return res.json({ success: true, data: categories });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/admin/categories', requireAdmin, async (req, res) => {
  try {
    const { name, slug, description, image, isActive, displayOrder } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }

    const categorySlug = slug
      ? slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
      : name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const catPayload = {
      _id: `cat_${Date.now()}`,
      name: name.trim(),
      slug: categorySlug,
      description: description || '',
      image: image || '',
      isActive: isActive !== false,
      displayOrder: Number(displayOrder || 0),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const created = await localJsonStore.addCategory(catPayload);
    return res.status(201).json({ success: true, message: 'Category created', data: created });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/admin/categories/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    delete updateData._id;

    if (updateData.displayOrder !== undefined) {
      updateData.displayOrder = Number(updateData.displayOrder || 0);
    }

    const updated = await localJsonStore.updateCategory(id, updateData);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    return res.json({ success: true, message: 'Category updated', data: updated });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/admin/categories/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await localJsonStore.deleteCategory(id);
    return res.json({ success: true, message: 'Category deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// =========================================================================
// 5. ADMIN ORDER MANAGEMENT (Backed by local JSON store)
// =========================================================================

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  try {
    const { status, search } = req.query;
    const orders = await localJsonStore.getOrders({ status: status === 'All' ? undefined : status, search });
    return res.json({ success: true, data: orders, count: orders.length });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/admin/orders/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const order = await localJsonStore.getOrderById(id);

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    return res.json({ success: true, data: order });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/admin/orders/:id/status', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, note, internalNotes } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required' });
    }

    const validStatuses = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status code' });
    }

    const updatedOrder = await localJsonStore.updateOrderStatus(id, status, note, req.admin?.username || 'Admin', internalNotes);
    if (!updatedOrder) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    try {
      await sendOrderToMongoDB(updatedOrder);
    } catch (mongoErr) {
      console.warn('[MongoDB Orders] Order status update notice:', mongoErr.message);
    }

    return res.json({ success: true, message: `Order status updated to ${status}`, data: updatedOrder });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/admin/orders/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await localJsonStore.deleteOrder(id);
    return res.json({ success: true, message: `Order #${id} deleted successfully` });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/admin/orders', requireAdmin, async (req, res) => {
  try {
    const { customer, items, orderStatus = 'Confirmed', internalNotes } = req.body;

    if (!customer || !customer.fullName || !customer.phoneNumber || !customer.address) {
      return res.status(400).json({
        success: false,
        message: 'Customer fullName, phoneNumber, and address are required'
      });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one order item is required'
      });
    }

    const cfg = await localJsonStore.getWebsiteConfig();
    const deliverySettings = cfg?.deliverySettings || defaultWebsiteConfig.deliverySettings;

    const deliveryFee = customer.deliveryArea === 'inside_dhaka'
      ? (deliverySettings.insideDhakaFee ?? 70)
      : (deliverySettings.outsideDhakaFee ?? 130);

    let verifiedItems = [];
    let calculatedSubtotal = 0;

    for (const item of items) {
      const productDoc = await localJsonStore.getProductBySlug(item.slug || item.productId);
      const unitPrice = item.unitPrice !== undefined ? Number(item.unitPrice) : (productDoc ? productDoc.salePrice : 0);
      const productName = item.productName || (productDoc ? productDoc.name : 'Custom Hair Care Product');
      const resolvedSlug = item.slug || (productDoc ? productDoc.slug : '') || '';
      const resolvedImage = item.image || (productDoc && productDoc.images?.[0]) || '';
      const quantity = Math.max(1, parseInt(item.quantity) || 1);

      calculatedSubtotal += unitPrice * quantity;

      verifiedItems.push({
        productId: productDoc ? String(productDoc._id) : (item.productId || resolvedSlug || 'manual-item'),
        slug: resolvedSlug,
        productName,
        category: item.category || (productDoc ? productDoc.category : 'Hair Care') || 'Hair Care',
        quantity,
        unitPrice,
        itemTotal: unitPrice * quantity,
        image: resolvedImage
      });
    }

    const finalTotal = calculatedSubtotal + deliveryFee;
    const orderId = generateOrderId();

    const orderPayload = {
      orderId,
      customer: {
        fullName: customer.fullName.trim(),
        phoneNumber: customer.phoneNumber.trim(),
        district: customer.district || (customer.deliveryArea === 'inside_dhaka' ? 'Dhaka' : 'Outside Dhaka'),
        deliveryArea: customer.deliveryArea || 'inside_dhaka',
        address: customer.address.trim(),
        notes: customer.notes?.trim() || ''
      },
      items: verifiedItems,
      subtotal: calculatedSubtotal,
      deliveryCharge: deliveryFee,
      finalTotal,
      paymentMethod: 'Cash on Delivery',
      paymentStatus: 'Pending',
      orderStatus,
      internalNotes: internalNotes || 'Manually created by Admin',
      statusHistory: [
        {
          status: orderStatus,
          timestamp: new Date().toISOString(),
          note: 'Order manually created via Admin Panel',
          updatedBy: req.admin?.username || 'Admin'
        }
      ],
      attribution: {
        utmSource: 'admin_manual',
        utmMedium: 'admin_dashboard'
      }
    };

    const createdOrder = await localJsonStore.addOrder(orderPayload);

    // 3b. Mirror order details to MongoDB collection (fault-tolerant & resilient)
    try {
      await sendOrderToMongoDB(createdOrder);
    } catch (mongoErr) {
      console.warn('[MongoDB Orders] Background order sync notice:', mongoErr.message);
    }

    return res.status(201).json({
      success: true,
      message: `Manual order #${orderId} created successfully`,
      orderId,
      data: createdOrder
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// =========================================================================
// 6. ADMIN CENTRALIZED WEBSITE DATA & CMS CONFIGURATION (Backed by local JSON)
// =========================================================================

// GET /api/admin/website-data - Full document read for Admin CMS
app.get('/api/admin/website-data', requireAdmin, async (req, res) => {
  try {
    const data = await localJsonStore.getWebsiteData();
    const cloned = JSON.parse(JSON.stringify(data));
    if (!cloned.metaSettings) cloned.metaSettings = {};
    cloned.metaSettings.pixelId = process.env.META_PIXEL_ID || '';
    return res.json({ success: true, version: cloned.version || 1, data: cloned });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/admin/website-data - Whole-document save with optimistic concurrency control
app.put('/api/admin/website-data', requireAdmin, async (req, res) => {
  try {
    const { version, expectedVersion, ...updateData } = req.body;
    delete updateData._id;

    // Remove any accidental secret tokens from updateData so they are never saved to disk
    if (updateData.metaSettings) {
      delete updateData.metaSettings.capiAccessToken;
      delete updateData.metaSettings.pixelId;
    }

    const reqVersion = typeof version === 'number' ? version : (typeof expectedVersion === 'number' ? expectedVersion : null);
    const updated = await localJsonStore.updateWebsiteData(updateData, reqVersion);

    return res.json({
      success: true,
      message: 'Website data updated successfully (saved to local JSON)',
      version: updated.version,
      data: updated
    });
  } catch (err) {
    if (err.conflict) {
      return res.status(409).json({
        success: false,
        conflict: true,
        message: err.message,
        currentVersion: err.currentVersion
      });
    }
    console.error('Error saving website data:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/admin/site-config', requireAdmin, async (req, res) => {
  try {
    const config = await localJsonStore.getWebsiteConfig();
    const cloned = JSON.parse(JSON.stringify(config));
    if (!cloned.metaSettings) cloned.metaSettings = {};
    cloned.metaSettings.pixelId = process.env.META_PIXEL_ID || '';
    cloned.metaSettings.isCapiConfigured = Boolean(process.env.META_CAPI_ACCESS_TOKEN);
    cloned.metaSettings.isPixelConfigured = Boolean(process.env.META_PIXEL_ID);
    return res.json({ success: true, data: cloned });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/admin/site-config', requireAdmin, async (req, res) => {
  try {
    const updateData = { ...req.body };
    delete updateData._id;

    if (updateData.metaSettings) {
      delete updateData.metaSettings.capiAccessToken;
      delete updateData.metaSettings.pixelId;
    }

    const savedConfig = await localJsonStore.updateWebsiteConfig(updateData);

    return res.json({
      success: true,
      message: 'Website configuration updated successfully!',
      data: savedConfig
    });
  } catch (err) {
    console.error('Error saving website config:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// =========================================================================
// 7. IMAGE UPLOAD HANDLER
// =========================================================================

app.post('/api/upload', requireAdmin, async (req, res) => {
  try {
    const { image, folder = 'haircare' } = req.body;

    if (!image) {
      return res.status(400).json({ success: false, message: 'Image data or URL required' });
    }

    // If it's already an HTTP URL, return as-is
    if (typeof image === 'string' && (image.startsWith('http://') || image.startsWith('https://'))) {
      return res.json({ success: true, url: image });
    }

    // If Cloudinary is configured, upload to Cloudinary
    if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
      const uploadResult = await cloudinary.uploader.upload(image, {
        folder: folder,
        resource_type: 'auto'
      });
      return res.json({ success: true, url: uploadResult.secure_url });
    }

    // Fallback: Return the image (e.g. data URI) directly without crashing
    return res.json({
      success: true,
      url: image,
      notice: 'Stored as data URL (configure Cloudinary in .env for CDN hosting)'
    });
  } catch (err) {
    console.error('Image upload error:', err);
    return res.status(500).json({ success: false, message: 'Failed to upload image: ' + err.message });
  }
});

// =========================================================================
// 8. ADMIN META CAPI EVENT LOGS MANAGEMENT (Backed by local JSON store)
// =========================================================================

// GET /api/admin/meta/verify-connection - Test Meta Graph API connection with .env credentials
app.get('/api/admin/meta/verify-connection', requireAdmin, async (req, res) => {
  try {
    const pixelId = process.env.META_PIXEL_ID;
    let token = process.env.META_CAPI_ACCESS_TOKEN;

    if (!pixelId) {
      return res.json({
        success: false,
        connected: false,
        message: 'META_PIXEL_ID is not configured in .env'
      });
    }

    if (!token) {
      return res.json({
        success: false,
        connected: false,
        message: 'META_CAPI_ACCESS_TOKEN is not configured in .env'
      });
    }

    token = token.trim();
    if (token.startsWith('aEAA')) {
      token = token.substring(1);
    }

    const graphRes = await axios.get(`https://graph.facebook.com/v19.0/${pixelId.trim()}`, {
      params: {
        fields: 'id,name',
        access_token: token
      },
      timeout: 8000
    });

    return res.json({
      success: true,
      connected: true,
      datasetName: graphRes.data?.name || 'Meta Dataset / Pixel',
      pixelId: graphRes.data?.id || pixelId,
      message: 'Successfully connected and verified with Meta Graph API!'
    });
  } catch (err) {
    const metaError = err.response?.data?.error;
    const errorMessage = metaError
      ? `${metaError.message} (Code: ${metaError.code}${metaError.error_subcode ? `, Subcode: ${metaError.error_subcode}` : ''})`
      : err.message;

    return res.json({
      success: false,
      connected: false,
      message: errorMessage,
      fbtrace_id: metaError?.fbtrace_id
    });
  }
});

// GET /api/admin/meta/logs - Paginated logs with search & filters
app.get('/api/admin/meta/logs', requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));

    const filter = {};
    if (req.query.eventName && req.query.eventName !== 'ALL') {
      filter.eventName = req.query.eventName;
    }
    if (req.query.status && req.query.status !== 'ALL') {
      filter.status = req.query.status;
    }
    if (req.query.search) {
      filter.search = req.query.search.trim();
    }
    if (req.query.orderId) {
      filter.orderId = req.query.orderId.trim();
    }
    if (req.query.eventId) {
      filter.eventId = req.query.eventId.trim();
    }

    const { logs, totalCount, stats } = await localJsonStore.getMetaLogs(filter, page, limit);

    return res.json({
      success: true,
      data: logs,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit) || 1
      },
      stats
    });
  } catch (err) {
    console.error('Error fetching Meta CAPI logs:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve CAPI logs: ' + err.message });
  }
});

// GET /api/admin/meta/logs/:id - Full individual log inspection
app.get('/api/admin/meta/logs/:id', requireAdmin, async (req, res) => {
  try {
    const log = await localJsonStore.getMetaLogById(req.params.id);
    if (!log) {
      return res.status(404).json({ success: false, message: 'Log record not found' });
    }
    return res.json({ success: true, data: log });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch log details: ' + err.message });
  }
});

// POST /api/admin/meta/logs/:id/retry - Manual retry of a failed or timed-out CAPI event
app.post('/api/admin/meta/logs/:id/retry', requireAdmin, async (req, res) => {
  try {
    const result = await retryMetaCapiEvent(req.params.id);
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Retry operation failed: ' + err.message });
  }
});

// DELETE /api/admin/meta/logs - Safe manual cleanup of CAPI logs
app.delete('/api/admin/meta/logs', requireAdmin, async (req, res) => {
  try {
    const { olderThanDays } = req.query;
    const filter = {};
    if (olderThanDays) {
      filter.olderThanDays = parseInt(olderThanDays) || 0;
    }
    const result = await localJsonStore.deleteMetaLogs(filter);
    return res.json({
      success: true,
      message: `Successfully deleted ${result.deletedCount} log records`,
      deletedCount: result.deletedCount
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to clear logs: ' + err.message });
  }
});

export default app;
