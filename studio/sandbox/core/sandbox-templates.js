// ---------------------------------------------------------------------------
// sandbox-templates.js — Framework scaffold templates for the sandbox container.
// Each key is a template name; values are maps of vfs-path → file content.
// ---------------------------------------------------------------------------

// Packages to install per template (one npm.install call per entry).
// null means no extra install is needed beyond what's already bundled.
export const TEMPLATE_INSTALL_SPECS = {
	http: null,
	express: null,
	"vite-react": [
		"react@18.2.0",
		"react-dom@18.2.0",
		"vite@5.0.0",
		"@vitejs/plugin-react@4.0.0",
		"@radix-ui/react-slot@1.1.0",
		"@radix-ui/react-label@2.1.0",
		"class-variance-authority@0.7.1",
		"clsx@2.1.1",
		"tailwind-merge@2.5.5",
		"lucide-react@0.468.0",
		"tailwindcss@3.4.17",
		"postcss@8.4.49",
		"autoprefixer@10.4.20",
	],
	"next-pages": ["next", "react", "react-dom"],
	"next-app": ["next", "react", "react-dom"],
};

export const FRAMEWORK_TEMPLATES = {
	http: {
		"/server.js": `const http = require('http');

const server = http.createServer((req, res) => {
  console.log(\`\${req.method} \${req.url}\`);

  if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end(\`
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: system-ui, sans-serif;
              padding: 2rem;
              background: #0c0c0c;
              min-height: 100vh;
              margin: 0;
              display: flex;
              align-items: center;
              justify-content: center;
              color: #c0c0c0;
            }
            .card {
              border: 1px solid #2a2a2a;
              padding: 2rem;
              max-width: 480px;
            }
            h1 { color: #00ff88; margin-top: 0; }
            a { color: #00ff88; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Agent Runtime Active</h1>
            <p>This HTTP server is running inside an isolated browser runtime.</p>
            <p>Try <a href="/api/time">/api/time</a> or <a href="/api/random">/api/random</a></p>
          </div>
        </body>
      </html>
    \`);
  } else if (req.url === '/api/time') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ time: new Date().toISOString() }));
  } else if (req.url === '/api/random') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ random: Math.random() }));
  } else {
    res.statusCode = 404;
    res.end('Not Found');
  }
});

server.listen(3000, () => {
  console.log('Server running on port 3000');
});
`,
	},

	express: {
		"/server.js": `const express = require('express');
const app = express();

// Middleware to parse JSON
app.use(express.json());

// Home route
app.get('/', (req, res) => {
  console.log('GET /');
  res.send(\`
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body {
            font-family: system-ui, sans-serif;
            padding: 2rem;
            background: #0c0c0c;
            min-height: 100vh;
            margin: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #c0c0c0;
          }
          .card {
            border: 1px solid #2a2a2a;
            padding: 2rem;
            max-width: 480px;
          }
          h1 { color: #00ff88; margin-top: 0; }
          a { color: #00ff88; font-weight: bold; }
          code { background: #1a1a1a; padding: 2px 6px; border: 1px solid #2a2a2a; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Express Agent Runtime</h1>
          <p>This Express server is running inside an isolated browser runtime.</p>
          <p>Routes:</p>
          <p><a href="/api/users">/api/users</a> — list all users</p>
          <p><a href="/api/time">/api/time</a> — current time</p>
        </div>
      </body>
    </html>
  \`);
});

// API routes
app.get('/api/users', (req, res) => {
  console.log('GET /api/users');
  res.json([
    { id: 1, name: 'Alice', email: 'alice@example.com' },
    { id: 2, name: 'Bob', email: 'bob@example.com' },
    { id: 3, name: 'Charlie', email: 'charlie@example.com' }
  ]);
});

app.get('/api/time', (req, res) => {
  console.log('GET /api/time');
  res.json({
    timestamp: Date.now(),
    iso: new Date().toISOString(),
    readable: new Date().toLocaleString()
  });
});

app.get('/api/random', (req, res) => {
  console.log('GET /api/random');
  res.json({
    number: Math.random(),
    dice: Math.floor(Math.random() * 6) + 1
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.path });
});

// Start server
app.listen(3000, () => {
  console.log('Express server running on port 3000');
});
`,
	},

	"vite-react": {
		"/package.json": JSON.stringify(
			{
				name: "vite-react-app",
				private: true,
				version: "0.0.0",
				type: "module",
				scripts: {
					dev: "vite",
					build: "vite build",
					preview: "vite preview",
				},
				dependencies: {
					"@radix-ui/react-label": "^2.1.0",
					"@radix-ui/react-slot": "^1.1.0",
					"class-variance-authority": "^0.7.1",
					clsx: "^2.1.1",
					"lucide-react": "^0.468.0",
					react: "^18.2.0",
					"react-dom": "^18.2.0",
					"tailwind-merge": "^2.5.5",
				},
				devDependencies: {
					"@vitejs/plugin-react": "^4.0.0",
					autoprefixer: "^10.4.20",
					postcss: "^8.4.49",
					tailwindcss: "^3.4.17",
					vite: "^5.0.0",
				},
			},
			null,
			2,
		),
		"/index.html": `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vite + React</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,
		"/vite.config.js": `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
`,
		"/postcss.config.js": `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`,
		"/tailwind.config.js": `/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [],
};
`,
		"/jsconfig.json": JSON.stringify(
			{
				compilerOptions: {
					baseUrl: ".",
					paths: {
						"@/*": ["./src/*"],
					},
				},
			},
			null,
			2,
		),
		"/src/main.jsx": `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`,
		"/src/index.css": `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 222.2 84% 4.9%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;
    --popover: 222.2 84% 4.9%;
    --popover-foreground: 210 40% 98%;
    --primary: 210 40% 98%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 212.7 26.8% 83.9%;
  }

  * {
    @apply border-border;
  }

  body {
    @apply bg-background text-foreground;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
}
`,
		"/src/lib/utils.js": `import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
`,
		"/src/components/ui/button.jsx": `import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow hover:bg-primary/90',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        outline:
          'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground',
        secondary:
          'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

const Button = React.forwardRef(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
`,
		"/src/components/ui/input.jsx": `import * as React from 'react';

import { cn } from '@/lib/utils';

const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = 'Input';

export { Input };
`,
		"/src/components/ui/label.jsx": `import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cva } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const labelVariants = cva(
  'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
);

const Label = React.forwardRef(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(labelVariants(), className)}
    {...props}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
`,
		"/src/components/ui/card.jsx": `import * as React from 'react';

import { cn } from '@/lib/utils';

const Card = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)}
    {...props}
  />
));
Card.displayName = 'Card';

const CardHeader = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
));
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn('text-2xl font-semibold leading-none tracking-tight', className)}
    {...props}
  />
));
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
));
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
));
CardFooter.displayName = 'CardFooter';

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
};
`,
		"/src/components/ui/textarea.jsx": `import * as React from 'react';

import { cn } from '@/lib/utils';

const Textarea = React.forwardRef(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        'flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';

export { Textarea };
`,
		"/src/App.jsx": `import React from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

function App() {
  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle>React + shadcn/ui</CardTitle>
          <CardDescription>
            Edit src/App.jsx and use the components in src/components/ui.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" placeholder="Project title" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" placeholder="Write a short note..." />
          </div>
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <Button variant="outline">Cancel</Button>
          <Button>Save changes</Button>
        </CardFooter>
      </Card>
    </main>
  );
}

export default App;
`,
		"/src/Counter.jsx": `import React, { useState } from 'react';

function Counter() {
  const [count, setCount] = useState(0);

  return (
    <section>
      <h2>Count: {count}</h2>
      <p>
        <button onClick={() => setCount(c => c - 1)}>-</button>
        <button onClick={() => setCount(0)}>Reset</button>
        <button onClick={() => setCount(c => c + 1)}>+</button>
      </p>
    </section>
  );
}

export default Counter;
`,
	},

	"next-pages": {
		"/package.json": JSON.stringify(
			{
				name: "next-pages-app",
				version: "0.1.0",
				private: true,
				scripts: {
					dev: "next dev",
					build: "next build",
					start: "next start",
				},
				dependencies: {
					next: "^14.0.0",
					react: "^18.2.0",
					"react-dom": "^18.2.0",
				},
			},
			null,
			2,
		),
		"/next.config.js": `/** @type {import('next').NextConfig} */
const nextConfig = {};
module.exports = nextConfig;
`,
		"/styles/globals.css": `* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: sans-serif; background: #f5f5f5; color: #333; }
`,
		"/pages/_app.jsx": `import '../styles/globals.css';

export default function App({ Component, pageProps }) {
  return <Component {...pageProps} />;
}
`,
		"/pages/index.jsx": `export default function Home() {
  return (
    <main style={{ maxWidth: 600, margin: '80px auto', padding: '0 20px' }}>
      <h1>Next.js Pages Router</h1>
      <p style={{ marginTop: 16 }}>
        Edit <code>pages/index.jsx</code> to get started.
      </p>
      <ul style={{ marginTop: 24, paddingLeft: 20 }}>
        <li><a href="/api/hello">GET /api/hello</a></li>
      </ul>
    </main>
  );
}
`,
		"/pages/api/hello.js": `export default function handler(req, res) {
  res.status(200).json({ message: 'Hello from Next.js API!', time: new Date().toISOString() });
}
`,
	},

	"next-app": {
		"/package.json": JSON.stringify(
			{
				name: "next-app-router",
				version: "0.1.0",
				private: true,
				scripts: {
					dev: "next dev",
					build: "next build",
					start: "next start",
				},
				dependencies: {
					next: "^14.0.0",
					react: "^18.2.0",
					"react-dom": "^18.2.0",
				},
			},
			null,
			2,
		),
		"/next.config.js": `/** @type {import('next').NextConfig} */
const nextConfig = {};
module.exports = nextConfig;
`,
		"/app/globals.css": `* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: sans-serif; background: #f5f5f5; color: #333; }
`,
		"/app/layout.jsx": `import './globals.css';

export const metadata = { title: 'Next.js App Router' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
		"/app/page.jsx": `export default function Page() {
  return (
    <main style={{ maxWidth: 600, margin: '80px auto', padding: '0 20px' }}>
      <h1>Next.js App Router</h1>
      <p style={{ marginTop: 16 }}>
        Edit <code>app/page.jsx</code> to get started.
      </p>
    </main>
  );
}
`,
		"/app/api/hello/route.js": `import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({ message: 'Hello from App Router API!', time: new Date().toISOString() });
}
`,
	},
};
