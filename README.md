# Regrow Hair Care BD — Premium E-commerce Website

A complete, production-oriented, mobile-first e-commerce web application for a hair care brand in Bangladesh specializing in authentic **topical Minoxidil 5%**, **540 Titanium Derma Rollers**, and **hair restoration combo packages**.

Engineered for **Netlify Free** deployment, **MongoDB Atlas Free Tier**, and direct **Facebook Ad & Meta Conversions API (CAPI)** traffic with Cash on Delivery (COD) order management.

---

## 🌟 Key Highlights & Features

1. **Premium Aesthetic & Mobile-First UX**
   - Deep navy visual identity (`#071B35`, `#0D294A`, `#174A7E`, `#3C83C5`) with crisp white and light-blue sections.
   - Smooth typography, clean borders, subtle shadows, and responsive touch targets.
   - Zero horizontal overflow on mobile screens.

2. **Distinctive Homepage Sections (in exact sequence)**
   - **Header & Navbar**: Sticky, compact navigation with section smooth-scroll, dynamic cart counter badge, and mobile drawer.
   - **Hero Section**: High-converting headline, authentic warranty pill, "Shop Now" & "How to Use" CTAs, star ratings, and hero product visuals.
   - **Floating Product Selector Carousel**: Story/profile-style circular thumbnails with gradient ring and float shadow. Supports mouse drag on desktop and touch swipe on mobile. Directly opens the selected product page.
   - **"It's Not Too Late to Start Now"**: Educational 2-column reassurance for early follicle intervention.
   - **"Understanding Hair Thinning"**: 3 visual stages (Healthy, Miniaturized, Scalp Exposure).
   - **"How Minoxidil Works"**: 4-stage mechanism of action (Potassium channels, Vasodilation, Anagen cycle prolongation, Hair thickening).
   - **"Every Journey Takes Time"**: Realistic chronological progress milestones (Starting Point, Month 1, Month 3, Month 6) with clear ethical disclaimer that results vary by individual.
   - **"How to Use Minoxidil"**: Clean 5-step numbered guide with safety notices and application infographic.
   - **Featured Products**: Dynamic product cards with regular price, sale price, real discount badges, and Add to Cart / Buy Now buttons.
   - **Footer**: Brand summary, quick links, policies, contact info, and WhatsApp link.

3. **Shop & Product Landing Pages**
   - Dedicated `/shop` route with dynamic category filtering, search bar, and sorting (Price low-to-high, high-to-low, newest, featured).
   - Product-specific URLs (`/product/:slug`) optimized for Facebook Ad direct linking. Preserves `fbclid` and all UTM tracking parameters without losing attribution.
   - Multi-image product gallery, stock indicators, quantity selectors, combo contents breakdown, and detailed specifications.

4. **Frictionless Shopping Cart & Cash on Delivery Checkout**
   - Persistent cart (LocalStorage).
   - Simplified Bangladeshi checkout: Name, Bangladeshi phone validation, District/City, Inside Dhaka (৳70) or Outside Dhaka (৳130) delivery fee selector, and Address.
   - Server-side price and stock validation (never trusts client prices).
   - Order confirmation with celebratory confetti, unique Order ID (e.g. `HAIR-2611-XXXX`), and direct WhatsApp order confirmation button.

5. **Complete Admin CMS & Operations Panel (`/admin`)**
   - Secure JWT authentication with bcrypt hashed password.
   - **Dashboard**: Live KPIs (Total Orders, Pending, Confirmed, Delivered, Cancelled, Revenue in ৳), top selling products, recent orders.
   - **Product Management**: Full CRUD, slug customization, stock count, combo item builder, multiple image URLs.
   - **Category Management**: Create, edit, hide categories.
   - **Order Management**: Search by order ID, phone number, customer name; filter by status; inspect ordered items snapshot; update status with history timestamps and internal notes.
   - **Homepage CMS Editor**: Section-by-section live editor for Hero, Carousel, Educational sections, Progress timeline, Usage guide, and Footer. Saves directly to the `websiteConfig` document in MongoDB.
   - **Store Settings**: Inside Dhaka fee, Outside Dhaka fee, Helpline, WhatsApp number, Depot address.
   - **Meta Integration**: Pixel ID, Test Event Code, enable/disable toggles, event verification guide.

6. **Facebook Meta Pixel & Conversions API (CAPI) Integration**
   - Browser Meta Pixel for `PageView`, `ViewContent`, `AddToCart`, `InitiateCheckout`, `Purchase`.
   - Server-Side Meta Conversions API via Netlify Functions for server-side order tracking.
   - **Event Deduplication**: Identical `event_id` dispatched across browser Pixel and server CAPI.
   - Automatic SHA-256 hashing for customer phone and name as required by Meta.
   - Attribution capture: `fbclid`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` captured and stored with the order.

7. **100% Netlify Free & MongoDB Atlas Compatible**
   - Serverless Netlify Functions architecture (`netlify/functions/api.js`).
   - SPA fallback redirects and `/api/*` redirects configured in `netlify.toml`.
   - Reusable MongoDB connections across function invocations with automatic fallback store.

---

## 🛠️ Technology Stack

- **Frontend**: React 19, Vite 8, Tailwind CSS v3, React Router v7, Lucide React, Canvas Confetti.
- **Backend**: Node.js, Express via `serverless-http`, Mongoose.
- **Database**: MongoDB Atlas Free Tier (Mongoose).
- **Deployment**: Netlify Free Plan.

---

## 📁 Project Structure

```text
minoxidil-website-antigravity/
├── src/
│   ├── admin/                         # Admin Panel Components
│   │   ├── AdminDashboard.jsx
│   │   ├── AdminProducts.jsx
│   │   ├── AdminCategories.jsx
│   │   ├── AdminOrders.jsx
│   │   ├── AdminHomepageEditor.jsx   # Interactive CMS Editor
│   │   ├── AdminSettings.jsx
│   │   ├── AdminMeta.jsx
│   │   ├── AdminLoginPage.jsx
│   │   └── AdminLayout.jsx
│   ├── components/
│   │   ├── common/                    # Navbar, Footer, CartDrawer, ProductCard, WhatsApp
│   │   └── home/                      # 8 Exact Homepage Sections
│   ├── context/                       # CartContext, AuthContext, ConfigContext
│   ├── pages/                         # Home, Shop, ProductDetail, Checkout, Success, Policies
│   ├── services/                      # Axios API Client
│   ├── utils/                         # Meta Pixel, CAPI, Formatters, Attribution
│   ├── styles/                        # Tailwind CSS Entry
│   ├── App.jsx
│   └── main.jsx
├── netlify/
│   └── functions/
│       ├── api.js                     # Serverless Netlify Function Handler
│       ├── app.js                     # Express Application (All Routes & Logic)
│       ├── db.js                      # MongoDB Connection & Memory Fallback Store
│       ├── models/                    # Mongoose Schemas (WebsiteConfig, Product, Order, etc.)
│       └── utils/                     # Meta CAPI Dispatcher
├── scripts/
│   ├── seed.js                        # Database Seeding & Admin Account Setup
│   └── test-api.js                    # Automated End-to-End API Test Suite
├── public/
├── dev-server.js                      # Local Backend Express Server (port 5000)
├── vite.config.js                     # Vite Config with /api proxy
├── tailwind.config.js                 # Custom Deep Navy Palette
├── netlify.toml                       # Netlify Build & Redirect Rules
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

---

## 🚀 Quick Start — Local Development

### Step 1: Install Dependencies

Open your terminal in the project directory:

```bash
npm install
```

### Step 2: Set Up Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

*(On Windows PowerShell: `Copy-Item .env.example .env`)*

Open `.env` and verify the default values:
- `ADMIN_USERNAME`: Your chosen administrator login name.
- `ADMIN_PASSWORD`: A unique administrator password.
- `JWT_SECRET`: A unique signing secret generated with `openssl rand -hex 32`.
- `PORT=5000`

> **Note:** The application includes a resilient fallback store, which means it will run immediately and allow you to test browsing, shopping cart, checkout, and admin panel even before you create a MongoDB Atlas cluster!

### Step 3: Run the Application Locally

Run both the frontend (Vite port 3000) and backend (Express port 5000) simultaneously:

```bash
npm run dev:all
```

Alternatively, you can run them in separate terminal windows:
- Terminal 1: `npm run dev` (Frontend: http://localhost:3000)
- Terminal 2: `npm run dev:server` (Backend: http://localhost:5000)

Open your browser at:
- **Storefront**: [http://localhost:3000](http://localhost:3000)
- **Admin Portal**: [http://localhost:3000/admin](http://localhost:3000/admin)

---

## 🍃 Step-by-Step MongoDB Atlas Free Setup

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register) and create a free account.
2. Click **Create a Deployment** and select the **M0 Free** cluster tier (Free Forever).
3. Select any nearby region (e.g., Singapore `ap-southeast-1` or Mumbai `ap-south-1`).
4. Under **Security Quickstart**:
   - Create a database user (e.g. Username: `haircare_admin`, Password: Choose a strong password).
   - Under **Network Access**, select **Allow Access from Anywhere** (`0.0.0.0/0`) so that Netlify Functions can connect without IP restrictions.
5. Click **Connect** &rarr; **Drivers** (Node.js).
6. Copy the connection string. It will look like:
   ```text
   mongodb+srv://haircare_admin:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
7. Replace `<password>` with your real password, and specify the database name `/haircare_store` right before the `?`:
   ```text
   mongodb+srv://haircare_admin:YourSecretPassword123@cluster0.xxxxx.mongodb.net/haircare_store?retryWrites=true&w=majority
   ```
8. Paste this into your `.env` file as:
   ```env
   MONGODB_URI=mongodb+srv://haircare_admin:YourSecretPassword123@cluster0.xxxxx.mongodb.net/haircare_store?retryWrites=true&w=majority
   ```
9. Run the seed script to populate initial sample products, categories, homepage configuration, and admin account:
   ```bash
   npm run seed
   ```

---

## 🌐 Netlify Free Deployment Guide

Deploying to Netlify Free takes less than 3 minutes:

### Method 1: Deploy via Git (Recommended)

1. Push your repository to GitHub, GitLab, or Bitbucket.
2. Log in to [Netlify](https://app.netlify.com/).
3. Click **Add new site** &rarr; **Import an existing project**.
4. Select your Git repository.
5. Netlify will automatically detect settings from `netlify.toml`:
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`
   - **Functions directory**: `netlify/functions`
6. Click **Environment variables** &rarr; **Add a variable** and configure:
   - `MONGODB_URI`: Your MongoDB Atlas connection string.
   - `JWT_SECRET`: A secure 32+ character random secret string.
   - `ADMIN_USERNAME`: Your desired admin username.
   - `ADMIN_PASSWORD`: Your desired admin password.
   - `META_PIXEL_ID`: *(Optional)* Your Facebook Meta Pixel ID.
   - `META_CAPI_ACCESS_TOKEN`: *(Optional)* Your Meta Conversions API Access Token.
   - `META_TEST_EVENT_CODE`: *(Optional)* For test event debugging.
   - `SITE_URL`: Your Netlify URL (e.g. `https://your-site-name.netlify.app`).
7. Click **Deploy Site**.
8. Once deployed, Netlify provides a live URL. Every page, product link (`/product/:slug`), and admin route (`/admin`) will work with SPA direct refresh support!

---

## 🎯 Meta Facebook Pixel & Conversions API (CAPI) Setup

Because traffic will primarily originate from Facebook mobile advertisements, tracking and deduplication are fully built-in:

### Step 1: Obtain Meta Credentials
1. Open [Meta Events Manager](https://business.facebook.com/events_manager2).
2. Choose your Pixel/Dataset.
3. Under **Settings**:
   - Copy your **Dataset / Pixel ID** (e.g. `987654321012345`).
   - Scroll down to **Conversions API** &rarr; click **Generate Access Token**.
   - Copy the long token string.

### Step 2: Configure in Store
- Set `META_PIXEL_ID` and `META_CAPI_ACCESS_TOKEN` in Netlify Environment Variables or `.env`.
- Alternatively, log into the Admin panel at `/admin/meta` to update your Pixel ID and toggle tracking on/off.

### Step 3: Test Events & Deduplication
1. In Meta Events Manager, go to the **Test Events** tab.
2. Copy your Test Event Code (e.g. `TEST84920`).
3. Paste it into `/admin/meta` under *Test Event Code* and click **Save Meta Configuration**.
4. Visit your website:
   - View a product &rarr; Fires `ViewContent`.
   - Add to cart &rarr; Fires `AddToCart`.
   - Initiate checkout &rarr; Fires `InitiateCheckout`.
   - Submit COD order &rarr; Fires `Purchase`.
5. Check Meta Events Manager. You will see both **Browser** and **Server** events appearing with matching `event_id` and showing **Deduplicated** status.

---

## 🔐 Admin Panel Guide

Access the admin portal at:
```text
https://your-domain.com/admin/login
```

Sign in with the `ADMIN_USERNAME` and `ADMIN_PASSWORD` configured in your environment. No password or signing secret is supplied by the application.

### What You Can Do in the Admin Panel:
1. **Dashboard**: View total revenue, order counts (Pending, Confirmed, Shipped, Delivered, Cancelled), and top-selling products.
2. **Product Catalog**: Add unlimited new products, set regular and sale prices, stock numbers, badges ("Best Seller", "Top Value"), multi-image URLs, and configure combo contents.
3. **Categories**: Create and manage categories (e.g. Minoxidil, Derma Roller, Combos).
4. **Order Management**: Search orders by customer phone, name, or Order ID. Change statuses (Pending &rarr; Confirmed &rarr; Shipped &rarr; Delivered &rarr; Cancelled), add internal notes, and click to chat with the customer directly on WhatsApp.
5. **Homepage CMS Editor**: Edit all headlines, descriptions, CTAs, timeline stages, usage instructions, and images without touching source code. Changes publish instantly.
6. **Website Settings**: Adjust delivery charges for Inside Dhaka and Outside Dhaka, phone number, and WhatsApp number.

---

## 🧪 Testing Checklist Verification

The application includes an automated test suite (`npm run test` or `node scripts/test-api.js`) verifying:

- [x] Public site configuration endpoint (`GET /api/site-config`).
- [x] Category listing (`GET /api/categories`).
- [x] Product catalog and filters (`GET /api/products`).
- [x] Facebook Ad direct product linking (`GET /api/products/:slug`).
- [x] Public Cash on Delivery order creation with server-side pricing recalculation (`POST /api/orders`).
- [x] Order lookup & confirmation tracking (`GET /api/orders/:orderId`).
- [x] Admin authentication & JWT token generation (`POST /api/admin/login`).
- [x] Admin KPI dashboard calculation (`GET /api/admin/dashboard`).
- [x] Order status transitions & timestamp history logging (`PUT /api/admin/orders/:id/status`).
- [x] Live Homepage CMS persistence (`PUT /api/admin/site-config`).
- [x] Production build verification (`npm run build`).

---

## 📄 License & Attribution

Developed with care for premium hair restoration e-commerce in Bangladesh. All rights reserved.

