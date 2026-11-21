import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { forkJoin } from 'rxjs';

interface RawUsageInput {
  rawProductId: number;
  name: string;
  unitType: string;
  availableStock: number;
  quantityUsed: number;
  isSelected: boolean;
}

@Component({
  selector: 'app-batches',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './batches.html',
  styleUrl: './batches.css'
})
export class BatchesComponent implements OnInit {
  private readonly apiService = inject(ApiService);

  batches = signal<any[]>([]);
  finishedProducts = signal<any[]>([]);
  rawProducts = signal<any[]>([]);

  isLoading = signal<boolean>(true);
  activeTab = signal<string>('list'); // 'list' or 'create'
  searchTerm = '';

  // Form states
  selectedFinishedProductId: number | null = null;
  quantityProduced = 0;
  rawUsageInputs: RawUsageInput[] = [];

  // Modals state
  activeModal = signal<string | null>(null); // 'detail' or 'edit' or 'delete'
  selectedBatchId = signal<number | null>(null);
  detailedBatch = signal<any | null>(null);
  
  modalError = signal<string | null>(null);
  modalSuccess = signal<string | null>(null);

  // Edit batch state
  editFinishedProductId: number | null = null;
  editQuantityProduced = 0;
  editRawUsageInputs: RawUsageInput[] = [];

  ngOnInit(): void {
    this.loadAllData();
  }

  loadAllData(): void {
    this.isLoading.set(true);
    forkJoin({
      batches: this.apiService.getBatches(),
      finished: this.apiService.getFinishedProducts(),
      raw: this.apiService.getRawProducts()
    }).subscribe({
      next: (res) => {
        this.batches.set(res.batches);
        this.finishedProducts.set(res.finished.filter(p => p.status === 'Active'));
        this.rawProducts.set(res.raw);
        this.resetCreateForm();
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load batches configuration:', err);
        this.isLoading.set(false);
      }
    });
  }

  resetCreateForm(): void {
    this.selectedFinishedProductId = null;
    this.quantityProduced = 0;
    
    // Map raw products list to input array
    this.rawUsageInputs = this.rawProducts().map(rp => ({
      rawProductId: rp.id,
      name: rp.name,
      unitType: rp.unitType,
      availableStock: Number(rp.currentStock),
      quantityUsed: 0,
      isSelected: false
    }));
  }

  get filteredBatches(): any[] {
    if (!this.searchTerm.trim()) {
      return this.batches();
    }
    const term = this.searchTerm.toLowerCase();
    return this.batches().filter(b => 
      b.batchNumber.toLowerCase().includes(term) ||
      (b.finishedProduct && b.finishedProduct.name.toLowerCase().includes(term))
    );
  }

  // Toggle selection of raw material for production
  toggleRawSelection(index: number, isEdit = false): void {
    const list = isEdit ? this.editRawUsageInputs : this.rawUsageInputs;
    list[index].isSelected = !list[index].isSelected;
    if (!list[index].isSelected) {
      list[index].quantityUsed = 0;
    }
  }

  // Form validations for Create/Edit
  validateStock(isEdit = false): { valid: boolean; message: string | null } {
    const list = isEdit ? this.editRawUsageInputs : this.rawUsageInputs;
    const selectedItems = list.filter(item => item.isSelected);
    
    if (selectedItems.length === 0) {
      return { valid: false, message: 'At least one raw material must be selected.' };
    }

    for (const item of selectedItems) {
      if (item.quantityUsed <= 0) {
        return { valid: false, message: `Please enter a valid quantity for "${item.name}".` };
      }
      
      // Stock checks (on creation, must not exceed available stock)
      // On edit, it's slightly different, but the backend validates it strictly. 
      // For frontend help: if they consume MORE than stock + what they already had, we warning.
      if (!isEdit && item.quantityUsed > item.availableStock) {
        return { valid: false, message: `Insufficient stock for "${item.name}". Available: ${item.availableStock}` };
      }
    }

    return { valid: true, message: null };
  }

  // Submit Batch Creation
  onSubmitCreate(): void {
    if (!this.selectedFinishedProductId || this.quantityProduced <= 0) {
      alert('Please fill out all required fields.');
      return;
    }

    const validation = this.validateStock(false);
    if (!validation.valid) {
      alert(validation.message);
      return;
    }

    const usages = this.rawUsageInputs
      .filter(item => item.isSelected)
      .map(item => ({
        rawProductId: item.rawProductId,
        quantityUsed: item.quantityUsed
      }));

    const payload = {
      finishedProductId: this.selectedFinishedProductId,
      quantity: this.quantityProduced,
      rawProductsUsed: usages
    };

    this.isLoading.set(true);
    this.apiService.createBatch(payload).subscribe({
      next: () => {
        this.activeTab.set('list');
        this.loadAllData();
      },
      error: (err) => {
        alert(err.error?.error || 'Failed to create batch.');
        this.isLoading.set(false);
      }
    });
  }

  // Open Modals
  openModal(batchId: number, type: string): void {
    this.selectedBatchId.set(batchId);
    this.activeModal.set(type);
    this.modalError.set(null);
    this.modalSuccess.set(null);

    this.apiService.getBatchById(batchId).subscribe({
      next: (batch) => {
        this.detailedBatch.set(batch);

        if (type === 'edit') {
          this.editFinishedProductId = batch.finishedProductId;
          this.editQuantityProduced = Number(batch.quantity);

          // Build edit usages maps
          const consumedMap = new Map<number, number>();
          batch.rawProductsConsumed.forEach((rc: any) => {
            consumedMap.set(rc.rawProductId, Number(rc.quantityUsed));
          });

          // Prepare the edit list: current stock is combined with batch's consumed stock 
          // to represent actual true maximum limit we can consume.
          this.editRawUsageInputs = this.rawProducts().map(rp => {
            const previouslyConsumed = consumedMap.get(rp.id) || 0;
            const trueAvailableLimit = Number(rp.currentStock) + previouslyConsumed;
            return {
              rawProductId: rp.id,
              name: rp.name,
              unitType: rp.unitType,
              availableStock: trueAvailableLimit,
              quantityUsed: previouslyConsumed,
              isSelected: previouslyConsumed > 0
            };
          });
        }
      },
      error: (err) => {
        this.modalError.set('Failed to retrieve batch information.');
        console.error('Fetch batch by id error:', err);
      }
    });
  }

  closeModal(): void {
    this.activeModal.set(null);
    this.selectedBatchId.set(null);
    this.detailedBatch.set(null);
    this.modalError.set(null);
    this.modalSuccess.set(null);
  }

  // Submit Batch Update
  onSubmitEdit(): void {
    const batchId = this.selectedBatchId();
    if (!batchId || !this.editFinishedProductId || this.editQuantityProduced <= 0) return;

    const validation = this.validateStock(true);
    if (!validation.valid) {
      this.modalError.set(validation.message);
      return;
    }

    const usages = this.editRawUsageInputs
      .filter(item => item.isSelected)
      .map(item => ({
        rawProductId: item.rawProductId,
        quantityUsed: item.quantityUsed
      }));

    const payload = {
      finishedProductId: this.editFinishedProductId,
      quantity: this.editQuantityProduced,
      rawProductsUsed: usages
    };

    this.apiService.updateBatch(batchId, payload).subscribe({
      next: () => {
        this.modalSuccess.set('Batch details updated and stock reconciled successfully.');
        setTimeout(() => {
          this.closeModal();
          this.loadAllData();
        }, 1500);
      },
      error: (err) => {
        this.modalError.set(err.error?.error || 'Failed to update batch.');
      }
    });
  }

  // Soft Delete Batch Reversal
  onConfirmDelete(): void {
    const batchId = this.selectedBatchId();
    if (!batchId) return;

    this.apiService.deleteBatch(batchId).subscribe({
      next: (res) => {
        this.modalSuccess.set(res.message);
        setTimeout(() => {
          this.closeModal();
          this.loadAllData();
        }, 1500);
      },
      error: (err) => {
        this.modalError.set(err.error?.error || 'Failed to delete batch.');
      }
    });
  }

  getFinishedProductName(id: number | null): string {
    if (!id) return '';
    const fp = this.finishedProducts().find(p => p.id === Number(id));
    return fp ? fp.name : '';
  }
}
