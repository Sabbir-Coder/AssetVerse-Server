# Project name: AssetVerse

- Purpose: Corporate Asset Management System

# Live URL: https://assets-verse.netlify.app/

- What is AssetVerse?
  AssetVerse is a comprehensive digital platform that helps companies efficiently manage their physical assets (laptops, keyboards, chairs, etc.) and track which employee has which equipment. It solves the common problem of companies losing track of valuable assets and streamlines the entire asset management process.

# Key features:

- Prevents asset loss and improves accountability
- Streamlines asset assignment and return processes
- Provides clear visibility into the company asset inventory
- Reduces administrative overhead for HR departments
- Ensures proper tracking of returnable vs non-returnable items
- HR Managers register their company, get a default subscription package (5 employees), and manage assets
- Employees register independently, request assets, and get affiliated with companies automatically
- Assets are tracked from inventory → assignment → return (optional)
- The system supports employees working with multiple companies simultaneously

# npm packages used

- headlessui/react
- tailwindcss
- "@tanstack
- axios
- firebase
- gsap
- react
- react-dom
- react-hook-form
- react-hot-toast
- react-icons
- react-router
- react-spinners
- recharts
- sweetalert2
- swiper

# Setup instructions

## Setup Instructions

Follow these steps to run the website locally:

### Prerequisites

- Node.js (v18+ recommended)
- npm or Yarn
- Git

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/your-repo.git
cd your-repo
npm install
# or
yarn install


* Environment variables configuration
cp .env.example .env

- VITE_API_URL= your api url
- VITE_apiKey= your api url
- VITE_authDomain=firebase
- VITE_projectId=firebase
- VITE_storageBucket=firebase
- VITE_messagingSenderId=firebase
- VITE_appId=1:firebase
- VITE_imgbb_Api_Key=Imgbb secret key
npm start
# or
yarn start
```
