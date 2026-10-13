import os from 'node:os';
import { DoctorReport, SandboxBackendType } from './types.js';
import { MacSeatbeltBackend } from './backends/macos.js';
import { LinuxBubblewrapBackend } from './backends/linux.js';
import { WindowsJobObjectBackend } from './backends/windows.js';

export function runSandboxDoctor(): DoctorReport {
  const currentOs = os.platform();
  const availableBackends: SandboxBackendType[] = ['host_isolated'];

  const macBackend = new MacSeatbeltBackend();
  if (macBackend.isAvailable) {
    availableBackends.push('seatbelt');
  }

  const linuxBackend = new LinuxBubblewrapBackend();
  if (linuxBackend.isAvailable) {
    availableBackends.push('bubblewrap');
  }

  const winBackend = new WindowsJobObjectBackend();
  if (winBackend.isAvailable) {
    availableBackends.push('job_object');
  }

  // Active backend selection
  let activeBackend: SandboxBackendType = 'host_isolated';
  let isOsSandboxed = false;
  let message = '';

  if (currentOs === 'darwin') {
    if (macBackend.isAvailable) {
      activeBackend = 'seatbelt';
      isOsSandboxed = true;
      message = 'Active isolation: macOS Seatbelt (kernel sandbox-exec profile enforced)';
    } else {
      activeBackend = 'host_isolated';
      isOsSandboxed = false;
      message =
        'Isolation: Host-Isolated (macOS Seatbelt binary unavailable; running application-level path & process isolation). NOT OS-sandboxed.';
    }
  } else if (currentOs === 'linux') {
    if (linuxBackend.isAvailable) {
      activeBackend = 'bubblewrap';
      isOsSandboxed = true;
      message = 'Active isolation: Linux Bubblewrap container isolation enforced';
    } else {
      activeBackend = 'host_isolated';
      isOsSandboxed = false;
      message =
        'Isolation: Host-Isolated (bwrap unavailable; running application-level path & process isolation). NOT OS-sandboxed.';
    }
  } else if (currentOs === 'win32') {
    activeBackend = 'job_object';
    isOsSandboxed = true;
    message = 'Active isolation: Windows Job Object process restrictions enforced';
  } else {
    activeBackend = 'host_isolated';
    isOsSandboxed = false;
    message =
      'Isolation: Host-Isolated (OS sandbox backend unavailable; running application-level path & process isolation). NOT OS-sandboxed.';
  }

  return {
    os: currentOs,
    activeBackend,
    isOsSandboxed,
    message,
    availableBackends,
  };
}
