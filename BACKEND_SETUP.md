# Backend Setup Instructions

The backend API is now set up to store situation reports in a SQLite database.

## Installation

### 1. Install Backend Dependencies
Navigate to the backend folder and install dependencies:
```bash
cd backend
npm install
```

### 2. Start the Backend Server
```bash
npm run dev
```

The server will start on `http://localhost:3001`

You should see:
```
Database initialized successfully
Server running on http://localhost:3001
```

## API Endpoints

Once the backend is running, the frontend will automatically connect to it. The frontend makes requests to these endpoints:

- **GET `/api/reports`** - Get all reports
- **GET `/api/reports/:id`** - Get a specific report  
- **POST `/api/reports`** - Create a new report
- **PUT `/api/reports/:id`** - Update a report
- **DELETE `/api/reports/:id`** - Delete a report

## Frontend Setup

The frontend is already configured to use the backend API. Just make sure:

1. The backend is running on `http://localhost:3001`
2. Start the frontend with `npm run dev` in the sitrep-app folder

## Database

The SQLite database is stored in `backend/reports.db` and is automatically created on first run.

Each report stores:
- id (auto-generated)
- title
- description
- severity (low, medium, high, critical)
- status (open, in-progress, closed)
- created_at (timestamp)
- updated_at (timestamp)

## Running Both Frontend and Backend

You'll need two terminal windows:

### Terminal 1 (Backend):
```bash
cd backend
npm install
npm run dev
```

### Terminal 2 (Frontend):
```bash
cd sitrep-app
npm run dev
```

Then open `http://localhost:5173` (or the port shown) in your browser.
