import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { AccessService } from '../../services/access.service';
import { money, today } from '../../shared/money';

interface OrderLine {
  rawProductId: number | null;
  quantityOrdered: number | null;
  unitRate: number | null;
}

@Component({
  selector: 'app-purchase-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './purchase-orders.html',
  styleUrl: './purchase-orders.css'
})
export class PurchaseOrdersComponent implements OnInit {
  private readonly apiService = inject(ApiService);
  readonly access = inject(AccessService);

  readonly money = money;
  readonly statusOptions = ['Draft', 'Ordered', 'Partially Received', 'Received', 'Cancelled'];
  readonly returnReasons = ['Damaged', 'Wrong Item', 'Excess Quantity', 'Quality Issue', 'Expired', 'Other'];

  orders = signal<any[]>([]);
  vendors = signal<any[]>([]);
  rawProducts = signal<any[]>([]);

  isLoading = signal<boolean>(true);
  isSaving = signal<boolean>(false);
  activeTab = signal<string>('list'); // 'list' | 'create'
  editingOrderId = signal<number | null>(null);

  filters = { status: '', vendorId: '', startDate: '', endDate: '', search: '' };

  form = this.blankForm();

  activeModal = signal<string | null>(null); // 'detail' | 'receive' | 'return' | 'cancel'
  selectedOrder = signal<any | null>(null);
  modalError = signal<string | null>(null);
  modalSuccess = signal<string | null>(null);

  receiveForm = { receivedDate: today(), vendorInvoiceNumber: '', otherCharges: 0, remarks: '', lines: [] as any[] };
  returnForm = { returnDate: today(), reason: 'Damaged', remarks: '', lines: [] as any[] };
  cancelReason = '';

  ngOnInit(): void {
    this.loadAll();
  }

  private blankForm() {
    return {
      vendorId: null as number | null,
      orderDate: today(),
      expectedDate: '',
      paymentMode: 'Credit',
      vendorInvoiceNumber: '',
      vendorInvoiceDate: '',
      discountAmount: 0,
      taxPercent: 0,
      remarks: '',
      items: [this.blankLine()] as OrderLine[]
    };
  }

  private blankLine(): OrderLine {
    return { rawProductId: null, quantityOrdered: null, unitRate: null };
  }

  loadAll(): void {
    this.isLoading.set(true);
    forkJoin({
      orders: this.apiService.getPurchaseOrders(),
      vendors: this.apiService.getVendors(),
      raw: this.apiService.getRawProducts()
    }).subscribe({
      next: (res) => {
        this.orders.set(res.orders);
        this.vendors.set(res.vendors.filter((v: any) => v.status === 'Active'));
        this.rawProducts.set(res.raw);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load purchase order data:', err);
        this.isLoading.set(false);
      }
    });
  }

  reloadOrders(): void {
    this.apiService.getPurchaseOrders().subscribe({
      next: (res) => this.orders.set(res),
      error: (err) => console.error('Reload orders error:', err)
    });
  }

  get filteredOrders(): any[] {
    const term = this.filters.search.trim().toLowerCase();
    return this.orders().filter((order) => {
      if (this.filters.status && order.status !== this.filters.status) return false;
      if (this.filters.vendorId && Number(order.vendorId) !== Number(this.filters.vendorId)) return false;
      if (this.filters.startDate && order.orderDate < this.filters.startDate) return false;
      if (this.filters.endDate && order.orderDate > this.filters.endDate) return false;
      if (term) {
        const haystack = `${order.poNumber} ${order.vendor?.name || ''}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }

  get totals(): any {
    const active = this.orders().filter((o) => o.status !== 'Cancelled');
    return {
      orders: this.orders().length,
      draft: active.filter((o) => o.status === 'Draft').length,
      awaiting: active.filter((o) => o.status === 'Ordered' || o.status === 'Partially Received').length,
      orderValue: active.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0),
      outstanding: active.reduce((sum, o) => sum + Number(o.outstanding || 0), 0)
    };
  }

  // ---------- create / edit ----------
  startNewOrder(): void {
    this.form = this.blankForm();
    this.editingOrderId.set(null);
    this.activeTab.set('create');
  }

  startEditOrder(order: any): void {
    this.editingOrderId.set(order.id);
    this.form = {
      vendorId: order.vendorId,
      orderDate: order.orderDate,
      expectedDate: order.expectedDate || '',
      paymentMode: order.paymentMode,
      vendorInvoiceNumber: order.vendorInvoiceNumber || '',
      vendorInvoiceDate: order.vendorInvoiceDate || '',
      discountAmount: Number(order.discountAmount) || 0,
      taxPercent: Number(order.taxPercent) || 0,
      remarks: order.remarks || '',
      items: order.items.map((item: any) => ({
        rawProductId: item.rawProductId,
        quantityOrdered: Number(item.quantityOrdered),
        unitRate: Number(item.unitRate)
      }))
    };
    this.activeTab.set('create');
  }

  addLine(): void {
    this.form.items.push(this.blankLine());
  }

  removeLine(index: number): void {
    if (this.form.items.length === 1) {
      this.form.items[0] = this.blankLine();
      return;
    }
    this.form.items.splice(index, 1);
  }

  /** Price memory: reuse the last rate quoted for this item so re-orders stay consistent. */
  onProductChange(line: OrderLine): void {
    if (line.unitRate || !line.rawProductId) return;
    const history = this.orders()
      .filter((order) => order.status !== 'Cancelled')
      .flatMap((order) => order.items || [])
      .filter((item: any) => item.rawProductId === Number(line.rawProductId))
      .sort((a: any, b: any) => (a.id < b.id ? 1 : -1));
    if (history.length) line.unitRate = Number(history[0].unitRate);
  }

  lineAmount(line: OrderLine): number {
    return (Number(line.quantityOrdered) || 0) * (Number(line.unitRate) || 0);
  }

  get subtotal(): number {
    return this.form.items.reduce((sum, line) => sum + this.lineAmount(line), 0);
  }

  get taxableAmount(): number {
    return Math.max(this.subtotal - (Number(this.form.discountAmount) || 0), 0);
  }

  get taxAmount(): number {
    return this.taxableAmount * ((Number(this.form.taxPercent) || 0) / 100);
  }

  get grandTotal(): number {
    return this.taxableAmount + this.taxAmount;
  }

  productOf(id: number | null): any {
    return this.rawProducts().find((product) => product.id === Number(id));
  }

  private validateForm(): string | null {
    if (!this.form.vendorId) return 'Select a vendor for this order.';
    const filled = this.form.items.filter((line) => line.rawProductId && Number(line.quantityOrdered) > 0);
    if (filled.length === 0) return 'Add at least one raw product with a quantity.';
    for (const line of filled) {
      if (Number(line.unitRate) < 0 || line.unitRate === null) {
        const product = this.productOf(line.rawProductId);
        return `Enter the purchase rate for ${product ? product.name : 'every line'}.`;
      }
    }
    const ids = filled.map((line) => Number(line.rawProductId));
    if (new Set(ids).size !== ids.length) return 'The same raw product appears twice. Merge those lines.';
    if (Number(this.form.discountAmount) > this.subtotal) return 'Discount cannot be more than the order subtotal.';
    if (Number(this.form.taxPercent) < 0 || Number(this.form.taxPercent) > 100) return 'Tax percent must be between 0 and 100.';
    return null;
  }

  private buildPayload() {
    return {
      vendorId: this.form.vendorId,
      orderDate: this.form.orderDate,
      expectedDate: this.form.expectedDate || null,
      paymentMode: this.form.paymentMode,
      vendorInvoiceNumber: this.form.vendorInvoiceNumber || null,
      vendorInvoiceDate: this.form.vendorInvoiceDate || null,
      discountAmount: Number(this.form.discountAmount) || 0,
      taxPercent: Number(this.form.taxPercent) || 0,
      remarks: this.form.remarks || null,
      items: this.form.items
        .filter((line) => line.rawProductId && Number(line.quantityOrdered) > 0)
        .map((line) => ({
          rawProductId: Number(line.rawProductId),
          quantityOrdered: Number(line.quantityOrdered),
          unitRate: Number(line.unitRate) || 0
        }))
    };
  }

  onSave(confirm: boolean): void {
    const invalid = this.validateForm();
    if (invalid) {
      alert(invalid);
      return;
    }

    const orderId = this.editingOrderId();
    const payload: any = this.buildPayload();
    const request = orderId
      ? this.apiService.updatePurchaseOrder(orderId, payload)
      : this.apiService.createPurchaseOrder(confirm ? { ...payload, confirm: true } : payload);

    this.isSaving.set(true);
    request.subscribe({
      next: (order) => {
        this.isSaving.set(false);
        if (orderId && confirm) {
          this.apiService.updatePurchaseOrderStatus(orderId, 'confirm').subscribe({
            next: () => this.finishSave(),
            error: (err) => alert(err.error?.error || 'Order saved but confirmation failed.')
          });
          return;
        }
        this.finishSave();
      },
      error: (err) => {
        this.isSaving.set(false);
        alert(err.error?.error || 'Failed to save purchase order.');
      }
    });
  }

  private finishSave(): void {
    this.form = this.blankForm();
    this.editingOrderId.set(null);
    this.activeTab.set('list');
    this.loadAll();
  }

  cancelEdit(): void {
    this.form = this.blankForm();
    this.editingOrderId.set(null);
    this.activeTab.set('list');
  }

  // ---------- status actions ----------
  confirmOrder(order: any): void {
    if (!confirm(`Confirm ${order.poNumber}? Vendor credit will be checked against the order value.`)) return;
    this.apiService.updatePurchaseOrderStatus(order.id, 'confirm').subscribe({
      next: () => this.reloadOrders(),
      error: (err) => alert(err.error?.error || 'Failed to confirm order.')
    });
  }

  deleteOrder(order: any): void {
    if (!confirm(`Delete draft ${order.poNumber}?`)) return;
    this.apiService.deletePurchaseOrder(order.id).subscribe({
      next: () => this.reloadOrders(),
      error: (err) => alert(err.error?.error || 'Failed to delete order.')
    });
  }

  // ---------- modals ----------
  openModal(order: any, type: string): void {
    this.activeModal.set(type);
    this.modalError.set(null);
    this.modalSuccess.set(null);
    this.selectedOrder.set(order);

    if (type === 'detail') {
      this.apiService.getPurchaseOrder(order.id).subscribe({
        next: (full) => this.selectedOrder.set(full),
        error: () => this.modalError.set('Could not load the full order document.')
      });
    }

    if (type === 'receive') {
      this.receiveForm = {
        receivedDate: today(),
        vendorInvoiceNumber: order.vendorInvoiceNumber || '',
        otherCharges: 0,
        remarks: '',
        lines: order.items
          .filter((item: any) => Number(item.remainingQuantity) > 0)
          .map((item: any) => ({
            purchaseOrderItemId: item.id,
            productName: item.rawProduct?.name,
            unitType: item.rawProduct?.unitType,
            remaining: Number(item.remainingQuantity),
            unitRate: Number(item.unitRate),
            quantityReceived: Number(item.remainingQuantity)
          }))
      };
    }

    if (type === 'return') {
      this.returnForm = {
        returnDate: today(),
        reason: 'Damaged',
        remarks: '',
        lines: order.items
          .filter((item: any) => Number(item.returnableQuantity) > 0)
          .map((item: any) => ({
            purchaseOrderItemId: item.id,
            productName: item.rawProduct?.name,
            unitType: item.rawProduct?.unitType,
            returnable: Number(item.returnableQuantity),
            unitRate: Number(item.unitRate),
            quantityReturned: 0
          }))
      };
    }

    if (type === 'cancel') {
      this.cancelReason = '';
    }
  }

  closeModal(): void {
    this.activeModal.set(null);
    this.selectedOrder.set(null);
    this.modalError.set(null);
    this.modalSuccess.set(null);
    this.reloadOrders();
  }

  get receiveValue(): number {
    return this.receiveForm.lines.reduce((sum, line) => sum + (Number(line.quantityReceived) || 0) * Number(line.unitRate), 0);
  }

  get returnValue(): number {
    return this.returnForm.lines.reduce((sum, line) => sum + (Number(line.quantityReturned) || 0) * Number(line.unitRate), 0);
  }

  onSubmitReceive(): void {
    const order = this.selectedOrder();
    if (!order) return;

    const lines = this.receiveForm.lines
      .filter((line) => Number(line.quantityReceived) > 0)
      .map((line) => ({
        purchaseOrderItemId: line.purchaseOrderItemId,
        quantityReceived: Number(line.quantityReceived)
      }));

    if (lines.length === 0) {
      this.modalError.set('Enter the quantity received on at least one line.');
      return;
    }

    this.apiService.createGoodsReceipt(order.id, {
      items: lines,
      receivedDate: this.receiveForm.receivedDate,
      vendorInvoiceNumber: this.receiveForm.vendorInvoiceNumber || null,
      otherCharges: Number(this.receiveForm.otherCharges) || 0,
      remarks: this.receiveForm.remarks || null
    }).subscribe({
      next: (res) => {
        this.modalError.set(null);
        this.modalSuccess.set(res.message);
        this.selectedOrder.set(res);
        setTimeout(() => this.closeModal(), 1400);
      },
      error: (err) => this.modalError.set(err.error?.error || 'Failed to receive goods.')
    });
  }

  onSubmitReturn(): void {
    const order = this.selectedOrder();
    if (!order) return;

    const lines = this.returnForm.lines
      .filter((line) => Number(line.quantityReturned) > 0)
      .map((line) => ({
        purchaseOrderItemId: line.purchaseOrderItemId,
        quantityReturned: Number(line.quantityReturned)
      }));

    if (lines.length === 0) {
      this.modalError.set('Enter the quantity to return on at least one line.');
      return;
    }

    this.apiService.createPurchaseReturn(order.id, {
      items: lines,
      returnDate: this.returnForm.returnDate,
      reason: this.returnForm.reason,
      remarks: this.returnForm.remarks || null
    }).subscribe({
      next: (res) => {
        this.modalError.set(null);
        this.modalSuccess.set(res.message);
        this.selectedOrder.set(res);
        setTimeout(() => this.closeModal(), 1400);
      },
      error: (err) => this.modalError.set(err.error?.error || 'Failed to record purchase return.')
    });
  }

  onSubmitCancel(): void {
    const order = this.selectedOrder();
    if (!order) return;
    this.apiService.updatePurchaseOrderStatus(order.id, 'cancel', this.cancelReason || undefined).subscribe({
      next: () => {
        this.modalSuccess.set(`${order.poNumber} cancelled.`);
        setTimeout(() => this.closeModal(), 1200);
      },
      error: (err) => this.modalError.set(err.error?.error || 'Failed to cancel order.')
    });
  }

  statusClass(status: string): string {
    if (status === 'Received') return 'badge-success';
    if (status === 'Cancelled') return 'badge-danger';
    if (status === 'Partially Received') return 'badge-info';
    if (status === 'Ordered') return 'badge-warning';
    return 'badge-draft';
  }
}
