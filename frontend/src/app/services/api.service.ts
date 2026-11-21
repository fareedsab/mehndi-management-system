import { Injectable, signal, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly baseUrl = environment.apiUrl;

  // Signals for Auth State
  readonly token = signal<string | null>(localStorage.getItem('token'));
  readonly currentUser = signal<any | null>(this.getStoredUser());

  private getStoredUser(): any | null {
    const userJson = localStorage.getItem('user');
    if (!userJson) return null;
    try {
      return JSON.parse(userJson);
    } catch {
      return null;
    }
  }

  // Get Auth Headers
  private getHeaders(): HttpHeaders {
    let headers = new HttpHeaders({
      'Content-Type': 'application/json'
    });
    const currentToken = this.token();
    if (currentToken) {
      headers = headers.set('Authorization', `Bearer ${currentToken}`);
    }
    return headers;
  }

  // Check if authenticated
  isAuthenticated(): boolean {
    return !!this.token();
  }

  // AUTH
  login(credentials: { username: string; password: string }): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/auth/login`, credentials).pipe(
      tap(res => {
        if (res.token) {
          localStorage.setItem('token', res.token);
          localStorage.setItem('user', JSON.stringify(res.user));
          this.token.set(res.token);
          this.currentUser.set(res.user);
        }
      })
    );
  }

  logout(): void {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    this.token.set(null);
    this.currentUser.set(null);
    this.router.navigate(['/login']);
  }

  // RAW PRODUCTS
  getRawProducts(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/raw-products`, { headers: this.getHeaders() });
  }

  createRawProduct(product: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/raw-products`, product, { headers: this.getHeaders() });
  }

  updateRawProduct(id: number, product: any): Observable<any> {
    return this.http.put<any>(`${this.baseUrl}/raw-products/${id}`, product, { headers: this.getHeaders() });
  }

  stockIn(id: number, data: { quantityAdded: number; purchaseReference?: string; remarks?: string }): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/raw-products/${id}/stock-in`, data, { headers: this.getHeaders() });
  }

  stockOut(id: number, data: { quantityDeducted: number; reason?: string; remarks?: string }): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/raw-products/${id}/stock-out`, data, { headers: this.getHeaders() });
  }

  // FINISHED PRODUCTS
  getFinishedProducts(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/finished-products`, { headers: this.getHeaders() });
  }

  createFinishedProduct(product: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/finished-products`, product, { headers: this.getHeaders() });
  }

  updateFinishedProduct(id: number, product: any): Observable<any> {
    return this.http.put<any>(`${this.baseUrl}/finished-products/${id}`, product, { headers: this.getHeaders() });
  }

  // BATCHES
  getBatches(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/batches`, { headers: this.getHeaders() });
  }

  getBatchById(id: number): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/batches/${id}`, { headers: this.getHeaders() });
  }

  createBatch(batch: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/batches`, batch, { headers: this.getHeaders() });
  }

  updateBatch(id: number, batch: any): Observable<any> {
    return this.http.put<any>(`${this.baseUrl}/batches/${id}`, batch, { headers: this.getHeaders() });
  }

  deleteBatch(id: number): Observable<any> {
    return this.http.delete<any>(`${this.baseUrl}/batches/${id}`, { headers: this.getHeaders() });
  }

  // REPORTS
  getProductionReport(params: { startDate?: string; endDate?: string; finishedProductId?: string; batchNumber?: string }): Observable<any[]> {
    let url = `${this.baseUrl}/reports/batch-production?`;
    if (params.startDate) url += `startDate=${params.startDate}&`;
    if (params.endDate) url += `endDate=${params.endDate}&`;
    if (params.finishedProductId) url += `finishedProductId=${params.finishedProductId}&`;
    if (params.batchNumber) url += `batchNumber=${params.batchNumber}&`;
    return this.http.get<any[]>(url, { headers: this.getHeaders() });
  }

  getConsumptionReport(params: { startDate?: string; endDate?: string; rawProductId?: string }): Observable<any[]> {
    let url = `${this.baseUrl}/reports/raw-consumption?`;
    if (params.startDate) url += `startDate=${params.startDate}&`;
    if (params.endDate) url += `endDate=${params.endDate}&`;
    if (params.rawProductId) url += `rawProductId=${params.rawProductId}&`;
    return this.http.get<any[]>(url, { headers: this.getHeaders() });
  }

  getLedgerReport(productId: number, params?: { startDate?: string; endDate?: string }): Observable<any[]> {
    let url = `${this.baseUrl}/reports/ledger/${productId}?`;
    if (params?.startDate) url += `startDate=${params.startDate}&`;
    if (params?.endDate) url += `endDate=${params.endDate}&`;
    return this.http.get<any[]>(url, { headers: this.getHeaders() });
  }

  // VENDORS & CREDIT MANAGEMENT
  getVendors(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/vendors`, { headers: this.getHeaders() });
  }

  getVendor(id: number): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/vendors/${id}`, { headers: this.getHeaders() });
  }

  createVendor(vendor: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/vendors`, vendor, { headers: this.getHeaders() });
  }

  updateVendor(id: number, vendor: any): Observable<any> {
    return this.http.put<any>(`${this.baseUrl}/vendors/${id}`, vendor, { headers: this.getHeaders() });
  }

  deleteVendor(id: number): Observable<any> {
    return this.http.delete<any>(`${this.baseUrl}/vendors/${id}`, { headers: this.getHeaders() });
  }

  getVendorLedger(id: number, params?: { startDate?: string; endDate?: string }): Observable<any> {
    let url = `${this.baseUrl}/vendors/${id}/ledger?`;
    if (params?.startDate) url += `startDate=${params.startDate}&`;
    if (params?.endDate) url += `endDate=${params.endDate}&`;
    return this.http.get<any>(url, { headers: this.getHeaders() });
  }

  getVendorOpenOrders(id: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/vendors/${id}/open-orders`, { headers: this.getHeaders() });
  }

  getVendorPayments(id: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/vendors/${id}/payments`, { headers: this.getHeaders() });
  }

  createVendorPayment(id: number, payment: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/vendors/${id}/payments`, payment, { headers: this.getHeaders() });
  }

  createVendorAdjustment(id: number, adjustment: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/vendors/${id}/adjustments`, adjustment, { headers: this.getHeaders() });
  }

  // PURCHASE ORDERS
  getPurchaseOrders(params?: Record<string, string>): Observable<any[]> {
    const query = params ? new HttpParams({ fromObject: params }) : undefined;
    return this.http.get<any[]>(`${this.baseUrl}/purchase-orders`, { headers: this.getHeaders(), params: query });
  }

  getPurchaseOrder(id: number): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/purchase-orders/${id}`, { headers: this.getHeaders() });
  }

  createPurchaseOrder(order: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/purchase-orders`, order, { headers: this.getHeaders() });
  }

  updatePurchaseOrder(id: number, order: any): Observable<any> {
    return this.http.put<any>(`${this.baseUrl}/purchase-orders/${id}`, order, { headers: this.getHeaders() });
  }

  updatePurchaseOrderStatus(id: number, action: string, reason?: string): Observable<any> {
    return this.http.patch<any>(`${this.baseUrl}/purchase-orders/${id}/status`, { action, reason }, { headers: this.getHeaders() });
  }

  deletePurchaseOrder(id: number): Observable<any> {
    return this.http.delete<any>(`${this.baseUrl}/purchase-orders/${id}`, { headers: this.getHeaders() });
  }

  createGoodsReceipt(orderId: number, receipt: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/purchase-orders/${orderId}/receipts`, receipt, { headers: this.getHeaders() });
  }

  createPurchaseReturn(orderId: number, purchaseReturn: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/purchase-orders/${orderId}/returns`, purchaseReturn, { headers: this.getHeaders() });
  }

  // PURCHASE REPORTS
  getPurchaseOrdersReport(params?: Record<string, string>): Observable<any> {
    const query = params ? new HttpParams({ fromObject: params }) : undefined;
    return this.http.get<any>(`${this.baseUrl}/reports/purchase-orders`, { headers: this.getHeaders(), params: query });
  }

  getVendorBalancesReport(): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/reports/vendor-balances`, { headers: this.getHeaders() });
  }

  getPurchaseSummaryReport(params?: Record<string, string>): Observable<any> {
    const query = params ? new HttpParams({ fromObject: params }) : undefined;
    return this.http.get<any>(`${this.baseUrl}/reports/purchase-summary`, { headers: this.getHeaders(), params: query });
  }
}
