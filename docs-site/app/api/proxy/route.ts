import { API_URL } from '@/lib/constants';
import { openapi } from '@/lib/openapi';

// API playground requests go through here (no CORS in the browser); only the Tenklo API is reachable.
export const { GET, HEAD, PUT, POST, PATCH, DELETE } = openapi.createProxy({
    allowedOrigins: [API_URL]
});
