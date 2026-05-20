import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ApolloProvider } from '@apollo/client';
import { client } from './apollo.js';
import { AuthProvider } from './auth/AuthProvider.jsx';
import { OrganisationProvider } from './auth/OrganisationContext.jsx';
import App from './App.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <ApolloProvider client={client}>
      <AuthProvider>
        <OrganisationProvider>
          <App />
        </OrganisationProvider>
      </AuthProvider>
    </ApolloProvider>
  </BrowserRouter>
);
