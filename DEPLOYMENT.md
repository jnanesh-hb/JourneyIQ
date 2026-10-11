# JourneyIQ — Deployment Guide

**Product:** JourneyIQ — Intelligence for Every Connection  
**Architecture:** Full-Stack Node.js Express Backend + Vite React Frontend

---

## 🚀 Quick Start Deployment Options

### Option 1: Render.com (Recommended — 1-Click Free Hosting)
1. Push this repository to GitHub or GitLab.
2. Log into [Render.com](https://render.com) and click **New → Web Service**.
3. Connect your repository.
4. Render will automatically detect `render.yaml` or you can manually enter:
   - **Build Command:** `npm run install:all && npm run build`
   - **Start Command:** `npm start`
   - **Environment:** Node
5. Click **Deploy Web Service**. Render will build the frontend and serve both API and UI on your live URL.

---

### Option 2: Docker / Container Deployment (Railway, Fly.io, AWS, GCP, Azure)
This repository includes a production-ready `Dockerfile`.

```bash
# Build the container image
docker build -t journeyiq .

# Run the container
docker run -p 3001:3001 journeyiq
```
Access the application at `http://localhost:3001`.

---

### Option 3: Vercel / Netlify Deployment
- **Frontend (Vercel/Netlify):** Set build command to `npm run build` and output directory to `frontend/dist`.
- **Backend (Render/Railway/Heroku):** Deploy `backend/` as a Node service.

---

### Option 4: Local Production Run
```bash
# 1. Install all dependencies
npm run install:all

# 2. Build production assets
npm run build

# 3. Start production server
npm start
```
Open [http://localhost:3001](http://localhost:3001) in your browser.

---

## 📋 Environment & Health Verification

- **Health Endpoint:** `GET /health`
- **Services Endpoint:** `GET /services`
- **Agent Chat Endpoint:** `POST /api/agent/chat`
- **Default Port:** `3001` (configurable via `PORT` environment variable)
