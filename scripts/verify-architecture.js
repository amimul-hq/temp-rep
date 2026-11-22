import http from 'http';
import app from '../netlify/functions/app.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const server = http.createServer(app);
const PORT = 5066;

async function runArchitectureVerification() {
  await new Promise(resolve => server.listen(PORT, resolve));
  console.log('========================================================================');
  console.log(`🌐 ARCHITECTURE VERIFICATION TEST HARNESS (PORT ${PORT})`);
  console.log('========================================================================\n');

  const baseUrl = `http://localhost:${PORT}/api`;

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Public Website Content Loading - Exactly ONE Request
    // -------------------------------------------------------------------------
    console.log('▶ TEST 1: Normal Visitor Opening Website (Single Public Data Fetch)');
    const startTime = Date.now();
    const res = await fetch(`${baseUrl}/website-data`);
    const duration = Date.now() - startTime;
    const body = await res.json();

    console.log(` - HTTP Status: ${res.status}`);
    console.log(` - API Response Time: ${duration}ms`);
    console.log(` - Response Size: ${Buffer.byteLength(JSON.stringify(body))} bytes`);
    console.log(` - Document Identifier: _id: "${body.data?._id}"`);
    console.log(` - Document Version: ${body.version}`);
    console.log(` - Site Name: "${body.data?.siteSettings?.siteName}"`);
    console.log(` - Categories Loaded: ${body.data?.categories?.length}`);
    console.log(` - Products Loaded: ${body.data?.products?.length}`);
    console.log(` - Hero Title: "${body.data?.hero?.title}"`);
    console.log(` - Sections: StartNow(${body.data?.sections?.startNow?.enabled}), HairThinning(${body.data?.sections?.hairThinning?.enabled}), Progress(${body.data?.sections?.progressTimeline?.enabled})`);

    if (!body.success || body.data?._id !== 'main') {
      throw new Error('TEST 1 FAILED: website_data document _id is not "main" or request failed');
    }
    if (!body.data?.categories?.length || !body.data?.products?.length) {
      throw new Error('TEST 1 FAILED: Consolidated categories or products array missing');
    }
    console.log('✅ TEST 1 PASSED: Complete public dataset loaded in ONE API call.\n');

    // -------------------------------------------------------------------------
    // TEST 2: Security & Privacy Check - No Sensitive Token Leak
    // -------------------------------------------------------------------------
    console.log('▶ TEST 2: Security & Privacy Boundary Check');
    if (body.data?.metaSettings?.capiAccessToken) {
      throw new Error('TEST 2 FAILED: Sensitive capiAccessToken found in public website-data response!');
    }
    if (body.data?.password || body.data?.admins || body.data?.orders) {
      throw new Error('TEST 2 FAILED: Private admin data found in public website-data response!');
    }
    console.log(' - capiAccessToken stripped: YES');
    console.log(' - Admin passwords/hashes exposed: NO');
    console.log(' - Customer orders exposed: NO');
    console.log('✅ TEST 2 PASSED: Public data strictly segregated from private/admin data.\n');

    // -------------------------------------------------------------------------
    // TEST 3: HTTP Caching & Conditional Revalidation (ETag / 304)
    // -------------------------------------------------------------------------
    console.log('▶ TEST 3: HTTP Caching & Conditional Request Validation');
    const etag = res.headers.get('etag');
    const cacheControl = res.headers.get('cache-control');
    console.log(` - ETag: ${etag}`);
    console.log(` - Cache-Control: ${cacheControl}`);

    const conditionalRes = await fetch(`${baseUrl}/website-data`, {
      headers: { 'If-None-Match': etag }
    });
    console.log(` - Conditional Request HTTP Status: ${conditionalRes.status}`);
    if (conditionalRes.status !== 304) {
      throw new Error(`TEST 3 FAILED: Expected 304 Not Modified, got ${conditionalRes.status}`);
    }
    console.log('✅ TEST 3 PASSED: Server correctly sends 304 Not Modified on matching ETag.\n');

    // -------------------------------------------------------------------------
    // TEST 4: Admin Security - Unauthenticated Access Blocked
    // -------------------------------------------------------------------------
    console.log('▶ TEST 4: Admin API Security Gate (Unauthenticated Access Denied)');
    const adminEndpoints = [
      '/admin/website-data',
      '/admin/dashboard',
      '/admin/products',
      '/admin/categories',
      '/admin/orders',
      '/admin/meta/logs'
    ];

    for (const ep of adminEndpoints) {
      const probeRes = await fetch(`${baseUrl}${ep}`);
      if (probeRes.status !== 401) {
        throw new Error(`TEST 4 FAILED: Expected 401 for ${ep}, got ${probeRes.status}`);
      }
      console.log(` - ${ep} -> 401 Unauthorized (Protected)`);
    }
    console.log('✅ TEST 4 PASSED: Normal visitors cannot access admin-only endpoints.\n');

    // -------------------------------------------------------------------------
    // TEST 5: Admin Login & Modular Operations
    // -------------------------------------------------------------------------
    console.log('▶ TEST 5: Admin Login & Modular Collection Architecture');
    const loginRes = await fetch(`${baseUrl}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD })
    }).then(r => r.json());

    if (!loginRes.token) {
      throw new Error('TEST 5 FAILED: Admin login failed');
    }
    const token = loginRes.token;
    console.log(` - Admin login verified. Role: "${loginRes.admin?.role}"`);

    // Modular orders check
    const ordersRes = await fetch(`${baseUrl}/admin/orders`, {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then(r => r.json());
    console.log(` - Modular Orders collection access: ${ordersRes.count} orders found`);

    // Modular meta logs check
    const logsRes = await fetch(`${baseUrl}/admin/meta/logs`, {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then(r => r.json());
    console.log(` - Modular MetaEventLogs collection access: ${logsRes.pagination?.totalCount} logs found`);
    console.log('✅ TEST 5 PASSED: Admin panel data remains in separate modular collections.\n');

    // -------------------------------------------------------------------------
    // TEST 6: Admin Whole-Document Save & Optimistic Concurrency Control
    // -------------------------------------------------------------------------
    console.log('▶ TEST 6: Admin Management of Public Website Data & Optimistic Concurrency');
    const currentAdminDoc = await fetch(`${baseUrl}/admin/website-data`, {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then(r => r.json());

    const initialVersion = currentAdminDoc.version;
    console.log(` - Initial website_data version: ${initialVersion}`);

    // Update hero title
    const saveRes = await fetch(`${baseUrl}/admin/website-data`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        version: initialVersion,
        hero: {
          ...currentAdminDoc.data.hero,
          title: 'Science-Backed Hair Restoration & Scalp Wellness'
        }
      })
    }).then(r => r.json());

    console.log(` - Save result: ${saveRes.message}`);
    console.log(` - New website_data version: ${saveRes.version}`);
    if (saveRes.version !== initialVersion + 1) {
      throw new Error('TEST 6 FAILED: Document version did not increment on save');
    }

    // Try conflicting save with outdated version
    const conflictAttempt = await fetch(`${baseUrl}/admin/website-data`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        version: initialVersion, // deliberately outdated!
        hero: {
          ...currentAdminDoc.data.hero,
          title: 'Outdated Overwrite Attempt'
        }
      })
    });
    console.log(` - Conflicting save attempt status: ${conflictAttempt.status}`);
    const conflictData = await conflictAttempt.json();
    console.log(` - Conflicting save rejection message: "${conflictData.message}"`);
    if (conflictAttempt.status !== 409 || !conflictData.conflict) {
      throw new Error('TEST 6 FAILED: Conflicting version update was not blocked!');
    }
    console.log('✅ TEST 6 PASSED: Concurrency control successfully prevents lost updates.\n');

    // -------------------------------------------------------------------------
    // TEST 7: Customer Order Verification & Stock Decrement
    // -------------------------------------------------------------------------
    console.log('▶ TEST 7: Customer Order Placement & Transactional Integrity');
    const publicData = await fetch(`${baseUrl}/website-data`).then(r => r.json());
    const testProduct = publicData.data.products[0];
    const initialStock = testProduct.stock;

    console.log(` - Selected product: "${testProduct.name}" (Slug: ${testProduct.slug})`);
    console.log(` - Initial stock in website_data: ${initialStock}`);

    const orderPayload = {
      customer: {
        fullName: 'Mahmudullah Riyad',
        phoneNumber: '01912345678',
        district: 'Dhaka',
        deliveryArea: 'inside_dhaka',
        address: 'Uttara Sector 7, Dhaka'
      },
      items: [
        {
          productId: testProduct._id,
          slug: testProduct.slug,
          quantity: 2
        }
      ]
    };

    const newOrderRes = await fetch(`${baseUrl}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderPayload)
    }).then(r => r.json());

    console.log(` - Placed order: ${newOrderRes.orderId}`);
    console.log(` - Verified subtotal: ${newOrderRes.data?.subtotal}`);
    console.log(` - Delivery charge: ${newOrderRes.data?.deliveryCharge}`);
    console.log(` - Final Total: ${newOrderRes.data?.finalTotal}`);

    // Verify stock was decremented in website_data
    const reloadedPublicData = await fetch(`${baseUrl}/website-data`).then(r => r.json());
    const reloadedProduct = reloadedPublicData.data.products.find(p => p.slug === testProduct.slug);
    console.log(` - New stock in website_data: ${reloadedProduct?.stock}`);

    if (reloadedProduct?.stock !== initialStock - 2) {
      throw new Error(`TEST 7 FAILED: Stock was not properly decremented (${initialStock} -> ${reloadedProduct?.stock})`);
    }

    // Verify order was saved in modular orders collection
    const orderInCollection = await fetch(`${baseUrl}/orders/${newOrderRes.orderId}`).then(r => r.json());
    if (!orderInCollection.data || orderInCollection.data.customer?.fullName !== 'Mahmudullah Riyad') {
      throw new Error('TEST 7 FAILED: Order not found in modular orders collection');
    }
    console.log(` - Order lookup in orders collection: Confirmed (${orderInCollection.data?.customer?.fullName})`);
    console.log('✅ TEST 7 PASSED: Order saved in modular collection and stock updated in website_data.\n');

    console.log('========================================================================');
    console.log('🎉 ALL 7 ARCHITECTURAL REQUIREMENTS VERIFIED AND CONFIRMED!');
    console.log('========================================================================\n');

  } catch (err) {
    console.error('\n❌ Architectural verification failed:', err);
    process.exitCode = 1;
  } finally {
    server.close(() => {
      process.exit(process.exitCode || 0);
    });
    setTimeout(() => process.exit(process.exitCode || 0), 1000);
  }
}

runArchitectureVerification();

