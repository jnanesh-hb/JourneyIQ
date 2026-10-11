# JourneyIQ Production Container Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root and workspace package definitions
COPY package.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

# Install dependencies for both backend and frontend
RUN npm run install:all

# Copy source code
COPY . .

# Build frontend production bundle
RUN npm run build

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

CMD ["npm", "start"]
