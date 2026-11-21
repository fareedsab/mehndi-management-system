import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AccessService } from '../../services/access.service';
import { money, today } from '../../shared/money';

const emptyVendorForm = () => ({
  name: '',
  code: '',
  contactPerson: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  ntn: '',
  creditLimit: 0,
  paymentTermsDays: 30,
  openingBalance: 0,
  remarks: '',
  status: 'Active'
});

@Component({
  selector: 'app-vendors',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './vendors.html',
  styleUrl: './vendors.css'
})
export class VendorsComponent implements OnInit {
  private readonly apiService = inject(ApiService);
  readonly access = inject(AccessService);
  private readonly router = inject(Router);

  readonly money = money;

  vendors = signal<any[]>([]);
  isLoading = signal<boolean>(true);
  activeTab = signal<string>('list');
  searchTerm = '';
  statusFilter = '';

  newVendor = emptyVendorForm();

  activeModal = signal<string | null>(null); // 'edit' | 'payment' | 'adjustment'
  selectedVendor = signal<any | null>(null);
  openOrders = signal<any[]>([]);
  modalError = signal<string | null>(null);
  modalSuccess = signal<string | null>(null);
  isSaving = signal<boolean>(false);

  editVendor = emptyVendorForm();
  payment = this.blankPayment();
  adjustment = this.blankAdjustment();

  ngOnInit(): void {
    this.loadVendors();
  }

  private blankPayment() {
    return {
      amount: null as number | null,
      paymentDate: today(),
      paymentType: 'Payment',
      method: 'Bank Transfer',
      referenceNumber: '',
      purchaseOrderId: null as number | null,
      remarks: ''
    };
  }

  private blankAdjustment() {
    return {
      amount: null as number | null,
      entryDate: today(),
      direction: 'Debit',
      entryType: 'Credit Note',
      purchaseOrderId: null as number | null,
      narration: ''
    };
  }

  loadVendors(): void {
    this.isLoading.set(true);
    this.apiService.getVendors().subscribe({
      next: (res) => {
        this.vendors.set(res);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Fetch vendors error:', err);
        this.isLoading.set(false);
      }
    });
  }

  get filteredVendors(): any[] {
    const term = this.searchTerm.trim().toLowerCase();
    return this.vendors().filter((vendor) => {
      const matchesText = !term
        || vendor.name.toLowerCase().includes(term)
        || (vendor.contactPerson || '').toLowerCase().includes(term)
        || (vendor.phone || '').toLowerCase().includes(term)
        || (vendor.code || '').toLowerCase().includes(term);
      const matchesStatus = !this.statusFilter || vendor.status === this.statusFilter;
      return matchesText && matchesStatus;
    });
  }

  get totals(): any {
    const list = this.vendors();
    return {
      payable: list.reduce((sum, v) => sum + Number(v.payableBalance || 0), 0),
      limit: list.reduce((sum, v) => sum + Number(v.creditLimit || 0), 0),
      overLimit: list.filter((v) => v.overLimit).length,
      openOrders: list.reduce((sum, v) => sum + Number(v.openOrders || 0), 0)
    };
  }

  onSubmitAdd(): void {
    if (!this.newVendor.name.trim()) {
      alert('Vendor name is required.');
      return;
    }
    this.isSaving.set(true);
    this.apiService.createVendor(this.newVendor).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.newVendor = emptyVendorForm();
        this.activeTab.set('list');
        this.loadVendors();
      },
      error: (err) => {
        this.isSaving.set(false);
        alert(err.error?.error || 'Failed to create vendor.');
      }
    });
  }

  openModal(vendor: any, type: string): void {
    this.selectedVendor.set(vendor);
    this.activeModal.set(type);
    this.modalError.set(null);
    this.modalSuccess.set(null);

    if (type === 'edit') {
      this.editVendor = {
        name: vendor.name,
        code: vendor.code || '',
        contactPerson: vendor.contactPerson || '',
        phone: vendor.phone || '',
        email: vendor.email || '',
        address: vendor.address || '',
        city: vendor.city || '',
        ntn: vendor.ntn || '',
        creditLimit: Number(vendor.creditLimit) || 0,
        paymentTermsDays: Number(vendor.paymentTermsDays) || 0,
        openingBalance: Number(vendor.openingBalance) || 0,
        remarks: vendor.remarks || '',
        status: vendor.status
      };
    } else if (type === 'payment') {
      this.payment = this.blankPayment();
      this.loadOpenOrders(vendor.id);
    } else if (type === 'adjustment') {
      this.adjustment = this.blankAdjustment();
      this.loadOpenOrders(vendor.id);
    }
  }

  private loadOpenOrders(vendorId: number): void {
    this.apiService.getVendorOpenOrders(vendorId).subscribe({
      next: (res) => this.openOrders.set(res),
      error: () => this.openOrders.set([])
    });
  }

  closeModal(): void {
    this.activeModal.set(null);
    this.selectedVendor.set(null);
    this.modalError.set(null);
    this.modalSuccess.set(null);
    this.openOrders.set([]);
  }

  onSubmitEdit(): void {
    const vendor = this.selectedVendor();
    if (!vendor) return;

    this.apiService.updateVendor(vendor.id, this.editVendor).subscribe({
      next: () => {
        this.modalSuccess.set('Vendor updated.');
        setTimeout(() => {
          this.closeModal();
          this.loadVendors();
        }, 900);
      },
      error: (err) => this.modalError.set(err.error?.error || 'Failed to update vendor.')
    });
  }

  onSubmitPayment(): void {
    const vendor = this.selectedVendor();
    if (!vendor) return;
    if (!this.payment.amount || Number(this.payment.amount) <= 0) {
      this.modalError.set('Enter a payment amount greater than zero.');
      return;
    }

    const payload: any = { ...this.payment };
    if (!payload.purchaseOrderId) delete payload.purchaseOrderId;

    this.apiService.createVendorPayment(vendor.id, payload).subscribe({
      next: (res) => {
        this.modalError.set(null);
        this.modalSuccess.set(`${res.voucherNumber} recorded. Vendor payable reduced by ${money(res.amount)}.`);
        this.loadOpenOrders(vendor.id);
        this.loadVendors();
        this.payment = { ...this.blankPayment(), purchaseOrderId: null };
      },
      error: (err) => this.modalError.set(err.error?.error || 'Failed to record payment.')
    });
  }

  onSubmitAdjustment(): void {
    const vendor = this.selectedVendor();
    if (!vendor) return;
    if (!this.adjustment.amount || Number(this.adjustment.amount) <= 0) {
      this.modalError.set('Enter an amount greater than zero.');
      return;
    }

    const payload: any = { ...this.adjustment };
    if (!payload.purchaseOrderId) delete payload.purchaseOrderId;

    this.apiService.createVendorAdjustment(vendor.id, payload).subscribe({
      next: (res) => {
        this.modalError.set(null);
        this.modalSuccess.set(`${res.entryType} posted. New balance: ${money(res.balanceAfter)}`);
        this.loadVendors();
        this.loadOpenOrders(vendor.id);
        this.adjustment = this.blankAdjustment();
      },
      error: (err) => this.modalError.set(err.error?.error || 'Failed to post adjustment.')
    });
  }

  viewStatement(vendor: any): void {
    this.router.navigate(['/vendor-ledger'], { queryParams: { vendorId: vendor.id } });
  }

  deleteVendor(vendor: any): void {
    if (!confirm(`Delete vendor "${vendor.name}"? Vendors with order history cannot be deleted.`)) return;
    this.apiService.deleteVendor(vendor.id).subscribe({
      next: () => this.loadVendors(),
      error: (err) => alert(err.error?.error || 'Failed to delete vendor.')
    });
  }

  utilizationPercent(vendor: any): number {
    if (!vendor.creditLimit || Number(vendor.creditLimit) <= 0) return 0;
    return Math.min(Number(vendor.creditUsagePercent) || 0, 100);
  }
}
