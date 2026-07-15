# Handshake - Project Structure

## Overview
Handshake is a monorepo project written primarily in **JavaScript (87.7%)** and **TypeScript (11.1%)** with a multi-package architecture for ASL (American Sign Language) detection and communication.

---

## Root Directory Structure

```
Handshake/
├── README.md                    # Main project documentation
├── DEVPOST.md                   # Devpost submission details
├── HANDOFF.md                   # Project handoff documentation
├── package.json                 # Root workspace configuration
├── package-lock.json            # Dependency lock file
├── Dockerfile                   # Docker container configuration
├── docker-compose.yml           # Docker compose orchestration
├── nginx.conf                   # Nginx web server configuration
├── .env.example                 # Example environment variables
├── .gitignore                   # Git ignore rules
├── .dockerignore                # Docker ignore rules
├── client/                      # Frontend/Client application
├── server/                      # Backend/Server application
├── shared/                      # Shared utilities and types
├── asl/                         # ASL detection and training
├── asl-detector/                # ASL detection library/module
└── docs/                        # Documentation
```

---

## Directory Details

### `/client` - Frontend Application
React/Vite-based web client for the Handshake application.

```
client/
├── index.html                   # Main HTML entry point
├── package.json                 # Client dependencies
├── tsconfig.json                # TypeScript configuration
├── vite.config.ts               # Vite build configuration
├── public/                      # Static assets
└── src/                         # Source code
    ├── Components/              # React components
    ├── Pages/                   # Page components
    ├── Hooks/                   # Custom React hooks
    ├── Styles/                  # CSS/styling
    └── Utils/                   # Utility functions
```

**Stack**: React, TypeScript, Vite

---

### `/server` - Backend Application
Express.js-based REST API server.

```
server/
├── package.json                 # Server dependencies
├── tsconfig.json                # TypeScript configuration
├── .env.example                 # Environment variables template
├── src/                         # Source code
│   ├── Routes/                  # API route handlers
│   ├── Controllers/             # Request controllers
│   ├── Models/                  # Data models
│   ├── Middleware/              # Express middleware
│   ├── Services/                # Business logic
│   └── Utils/                   # Utility functions
└── scripts/                     # Build and utility scripts
```

**Stack**: Node.js, Express, TypeScript

---

### `/shared` - Shared Code
Shared utilities, types, and constants used across packages.

```
shared/
├── package.json                 # Shared package configuration
├── tsconfig.json                # TypeScript configuration
└── src/                         # Shared source code
    ├── Types/                   # TypeScript type definitions
    ├── Constants/               # Shared constants
    ├── Utils/                   # Shared utility functions
    └── Interfaces/              # Shared interfaces
```

---

### `/asl` - ASL Detection & Training
Core ASL (American Sign Language) detection and model training module.

```
asl/
├── index.html                   # Demo/training interface
├── package.json                 # ASL module dependencies
├── tsconfig.json                # TypeScript configuration
├── vite.config.ts               # Vite build configuration
├── TRAINING.md                  # Model training documentation
├── INTEGRATION.md               # Integration guide
├── src/                         # Source code
│   ├── Models/                  # ML model code
│   ├── Utilities/               # ASL-specific utilities
│   └── Helpers/                 # Helper functions
├── model/                       # Trained ML models
│   └── *.json                   # Serialized model files
├── data/                        # Training datasets
├── demo/                        # Demo/showcase files
├── mediapipe-wasm/              # MediaPipe WebAssembly
├── tools/                       # Training and utility tools
└── training-runs/               # Historical training records
```

**Purpose**: 
- Handles real-time ASL sign detection using computer vision
- Contains model training scripts and utilities
- Includes WebAssembly (WASM) implementation for performance

**Technologies**: MediaPipe, WASM, Machine Learning

---

### `/asl-detector` - ASL Detection Library
Reusable ASL detection module/package.

```
asl-detector/
├── README.md                    # Library documentation
├── package.json                 # Package configuration
├── tsconfig.json                # TypeScript configuration
└── src/                         # Library source code
    ├── Detector.ts              # Main detector class
    ├── Types.ts                 # Type definitions
    └── Utils.ts                 # Utility functions
```

**Purpose**: Provides a clean API for ASL detection across the application

---

### `/docs` - Documentation
Project documentation and resources.

```
docs/
└── superpowers/                 # Feature documentation
    ├── *.md                     # Feature-specific docs
    └── Examples/                # Usage examples
```

---

## Configuration Files

| File | Purpose |
|------|---------|
| `package.json` | Root workspace and npm dependencies |
| `package-lock.json` | Locked dependency versions |
| `tsconfig.json` | (per package) TypeScript compiler options |
| `vite.config.ts` | (client/asl) Vite bundler configuration |
| `.env.example` | Template for environment variables |
| `Dockerfile` | Docker image definition |
| `docker-compose.yml` | Multi-container orchestration |
| `nginx.conf` | Reverse proxy configuration |
| `.gitignore` | Git ignore patterns |
| `.dockerignore` | Docker build ignore patterns |

---

## Technology Stack

### Frontend
- **Framework**: React
- **Language**: TypeScript / JavaScript
- **Build Tool**: Vite
- **Styling**: CSS/Sass

### Backend
- **Runtime**: Node.js
- **Framework**: Express.js
- **Language**: TypeScript

### ML/AI
- **Vision**: MediaPipe
- **Performance**: WebAssembly (WASM)
- **Model Format**: JSON serialized models

### Infrastructure
- **Containerization**: Docker
- **Orchestration**: Docker Compose
- **Web Server**: Nginx

### Package Management
- **Monorepo**: npm workspaces or Yarn workspaces
- **Lock File**: package-lock.json

---

## Deployment

The project uses Docker for containerization with `docker-compose.yml` for local development and orchestration:

- **Client**: Served via Nginx reverse proxy
- **Server**: Express API running in Node.js container
- **ASL Module**: Integrated into the client or as a service

---

## Key Features

1. **Real-time ASL Detection** - Computer vision-based sign language recognition
2. **Web Client** - Interactive React frontend for users
3. **REST API** - Backend services for data and business logic
4. **ML Model Training** - Tools and infrastructure for model refinement
5. **Containerized Deployment** - Docker setup for consistent environments

---

## Development Workflow

```bash
# Install dependencies across all packages
npm install

# Build all packages
npm run build

# Start development servers
npm run dev

# Docker deployment
docker-compose up
```

---

## Notes

- **Monorepo Structure**: Each major module has its own `package.json` and build configuration
- **TypeScript**: Used throughout for type safety
- **WASM**: Performance-critical ASL detection uses WebAssembly
- **Containerized**: Complete Docker setup for seamless deployment

---

Last Updated: 2026-07-15
