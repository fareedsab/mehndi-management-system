import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { forkJoin } from 'rxjs';
import { money } from '../../shared/money';

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './reports.html',
  styleUrl: './reports.css'
})
export class ReportsComponent implements OnInit {
  private readonly apiService = inject(ApiService);

  readonly money = money;

  isLoading = signal<boolean>(true);
  activeTab = signal<string>('production'); // 'production', 'consumption', 'ledger', 'po-summary', 'vendor-balances', 'purchase-summary'

  // Lists for dropdown filters
  finishedProducts = signal<any[]>([]);
  rawProducts = signal<any[]>([]);
  vendors = signal<any[]>([]);

  // Purchase order register report
  poFilters = { startDate: '', endDate: '', vendorId: '', status: '', search: '' };
  purchaseOrderReport = signal<any>({ rows: [], summary: {} });

  // Vendor balances and ageing report
  vendorBalances = signal<any>({ rows: [], totals: {} });

  // Purchase summary report
  psFilters = { startDate: '', endDate: '', vendorId: '' };
  purchaseSummary = signal<any>({ byProduct: [], byVendor: [], totals: {} });
  summaryView = signal<string>('product'); // 'product' | 'vendor'

  // Production Report parameters & results
  prodFilters = {
    startDate: '',
    endDate: '',
    finishedProductId: '',
    batchNumber: ''
  };
  productionResults = signal<any[]>([]);

  // Consumption Report parameters & results
  consFilters = {
    startDate: '',
    endDate: '',
    rawProductId: ''
  };
  consumptionResults = signal<any[]>([]);

  // Ledger Report parameters & results
  ledFilters = {
    rawProductId: '',
    startDate: '',
    endDate: ''
  };
  ledgerResults = signal<any[]>([]);

  ngOnInit(): void {
    this.loadFilterLists();
  }

  loadFilterLists(): void {
    this.isLoading.set(true);
    forkJoin({
      finished: this.apiService.getFinishedProducts(),
      raw: this.apiService.getRawProducts(),
      vendors: this.apiService.getVendors()
    }).subscribe({
      next: (res) => {
        this.finishedProducts.set(res.finished);
        this.rawProducts.set(res.raw);
        this.vendors.set(res.vendors);
        
        // Auto-select first raw product for ledger if available
        if (res.raw.length > 0) {
          this.ledFilters.rawProductId = String(res.raw[0].id);
        }

        // Run default reports
        this.runProductionReport();
        this.runConsumptionReport();
        this.runLedgerReport();
        this.runPurchaseOrderReport();
        this.runVendorBalances();
        this.runPurchaseSummary();

        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load filter dropdowns:', err);
        this.isLoading.set(false);
      }
    });
  }

  runProductionReport(): void {
    this.apiService.getProductionReport(this.prodFilters).subscribe({
      next: (res) => {
        this.productionResults.set(res);
      },
      error: (err) => {
        console.error('Production report fetch failed:', err);
      }
    });
  }

  runConsumptionReport(): void {
    this.apiService.getConsumptionReport(this.consFilters).subscribe({
      next: (res) => {
        this.consumptionResults.set(res);
      },
      error: (err) => {
        console.error('Consumption report fetch failed:', err);
      }
    });
  }

  runLedgerReport(): void {
    const pId = Number(this.ledFilters.rawProductId);
    if (!pId) return;

    this.apiService.getLedgerReport(pId, this.ledFilters).subscribe({
      next: (res) => {
        this.ledgerResults.set(res);
      },
      error: (err) => {
        console.error('Ledger report fetch failed:', err);
      }
    });
  }

  clearProdFilters(): void {
    this.prodFilters = {
      startDate: '',
      endDate: '',
      finishedProductId: '',
      batchNumber: ''
    };
    this.runProductionReport();
  }

  clearConsFilters(): void {
    this.consFilters = {
      startDate: '',
      endDate: '',
      rawProductId: ''
    };
    this.runConsumptionReport();
  }

  clearLedFilters(): void {
    const firstId = this.rawProducts().length > 0 ? String(this.rawProducts()[0].id) : '';
    this.ledFilters = {
      rawProductId: firstId,
      startDate: '',
      endDate: ''
    };
    this.runLedgerReport();
  }

  getSelectedRawProduct(): any | null {
    const pId = Number(this.ledFilters.rawProductId);
    if (!pId) return null;
    return this.rawProducts().find(p => p.id === pId) || null;
  }

  // ---------- Purchase / vendor reports ----------
  private prune(filters: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '' && value != null));
  }

  runPurchaseOrderReport(): void {
    this.apiService.getPurchaseOrdersReport(this.prune(this.poFilters)).subscribe({
      next: (res) => this.purchaseOrderReport.set(res),
      error: (err) => console.error('Purchase order report fetch failed:', err)
    });
  }

  clearPoFilters(): void {
    this.poFilters = { startDate: '', endDate: '', vendorId: '', status: '', search: '' };
    this.runPurchaseOrderReport();
  }

  runVendorBalances(): void {
    this.apiService.getVendorBalancesReport().subscribe({
      next: (res) => this.vendorBalances.set(res),
      error: (err) => console.error('Vendor balances report fetch failed:', err)
    });
  }

  runPurchaseSummary(): void {
    this.apiService.getPurchaseSummaryReport(this.prune(this.psFilters)).subscribe({
      next: (res) => this.purchaseSummary.set(res),
      error: (err) => console.error('Purchase summary report fetch failed:', err)
    });
  }

  clearPsFilters(): void {
    this.psFilters = { startDate: '', endDate: '', vendorId: '' };
    this.runPurchaseSummary();
  }

  overdueOf(row: any): number {
    const a = row.aging || {};
    return (a.d1to30 || 0) + (a.d31to60 || 0) + (a.d61to90 || 0) + (a.d90Plus || 0);
  }

  agingPercent(row: any, bucket: string): number {
    const a = row.aging || {};
    const total = ['notDue', 'd1to30', 'd31to60', 'd61to90', 'd90Plus']
      .reduce((sum, key) => sum + (Number(a[key]) || 0), 0);
    if (total <= 0) return 0;
    return Math.min(((Number(a[bucket]) || 0) / total) * 100, 100);
  }

  joinNames(list: any): string {
    return Array.isArray(list) ? list.filter(Boolean).join(', ') : '';
  }
}
