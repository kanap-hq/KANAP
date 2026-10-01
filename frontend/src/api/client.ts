import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { getAccessToken } from '../auth/accessTokenStore';
import { refreshTokenAndRetry } from '../api';

/**
 * Paginated response from the API
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Request parameters for paginated requests
 */
export interface PaginationParams {
  page?: number;
  limit?: number;
  sort?: string;
  q?: string;
  filters?: string;
  [key: string]: unknown;
}

/**
 * API error response structure
 */
export interface ApiError {
  message: string;
  code?: string;
  details?: Record<string, unknown>;
}

/**
 * Type-safe API client wrapper around Axios
 */
export class ApiClient {
  private instance: AxiosInstance;

  constructor(baseURL: string) {
    this.instance = axios.create({
      baseURL,
      withCredentials: true,
    });
    this.setupInterceptors();
  }

  /**
   * Configure request and response interceptors
   */
  private setupInterceptors(): void {
    // Request interceptor for auth token
    this.instance.interceptors.request.use((config) => {
      const token = getAccessToken();
      if (token) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // On a 401, refresh through the single flight shared with the main client (api.ts) and replay.
    this.instance.interceptors.response.use(
      (response) => response,
      (error) => refreshTokenAndRetry(error, this.instance),
    );
  }

  /**
   * GET request with typed response
   */
  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.instance.get(url, config);
    return response.data;
  }

  /**
   * POST request with typed request and response
   */
  async post<T, D = unknown>(url: string, data?: D, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.instance.post(url, data, config);
    return response.data;
  }

  /**
   * PUT request with typed request and response
   */
  async put<T, D = unknown>(url: string, data?: D, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.instance.put(url, data, config);
    return response.data;
  }

  /**
   * PATCH request with typed request and response
   */
  async patch<T, D = unknown>(url: string, data?: D, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.instance.patch(url, data, config);
    return response.data;
  }

  /**
   * DELETE request with typed response
   */
  async delete<T = void>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.instance.delete(url, config);
    return response.data;
  }

  /**
   * GET request specifically for paginated endpoints
   */
  async paginated<T>(url: string, params?: PaginationParams): Promise<PaginatedResponse<T>> {
    return this.get<PaginatedResponse<T>>(url, { params });
  }

  /**
   * Get the underlying Axios instance for advanced use cases
   * (e.g., custom interceptors, direct access to request/response objects)
   */
  getAxiosInstance(): AxiosInstance {
    return this.instance;
  }
}

// Default base URL from environment or fallback
const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

// Singleton API client instance
export const api = new ApiClient(baseURL);

// Export type utilities for endpoint definitions
export type { AxiosRequestConfig };
