FROM node:20-bookworm

WORKDIR /app


# =====================================================
# Install FFmpeg + Chromium dependencies
# =====================================================

RUN apt-get update && \
    apt-get install -y \
        ffmpeg \
        ca-certificates \
        fonts-liberation \
        fonts-noto-color-emoji \
        fonts-noto-core \
        fonts-noto-cjk \
        libnss3 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libcups2 \
        libdrm2 \
        libxkbcommon0 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxrandr2 \
        libgbm1 \
        libasound2 \
        libpangocairo-1.0-0 \
        libpango-1.0-0 \
        libcairo2 \
        libatspi2.0-0 \
        libgtk-3-0 \
        wget \
        curl \
    && rm -rf /var/lib/apt/lists/*


# =====================================================
# Node dependencies
# =====================================================

COPY renderer/package.json ./

RUN npm install


# =====================================================
# Install Playwright Chromium
# =====================================================

RUN npx playwright install chromium


# =====================================================
# Copy application
# =====================================================

#COPY server.js .
#COPY render.js .

COPY renderer/server.js /server.js
COPY renderer/render.js /render.js


# =====================================================
# Environment
# =====================================================

ENV NODE_ENV=production

ENV PORT=10000


# =====================================================
# Expose
# =====================================================

EXPOSE 10000


# =====================================================
# Start
# =====================================================

CMD ["node", "server.js"]

