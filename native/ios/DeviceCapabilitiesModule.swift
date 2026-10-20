import Foundation

/**
 * Reports the physical limits that decide which on-device models may be offered.
 * A model larger than the device can hold does not degrade - iOS kills the app -
 * so this has to be known before a multi-gigabyte download starts.
 */
@objc(DeviceCapabilities)
class DeviceCapabilitiesModule: NSObject {

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  @objc(getCapabilities:rejecter:)
  func getCapabilities(
    _ resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    let info = ProcessInfo.processInfo
    resolve([
      "totalMemoryBytes": Double(info.physicalMemory),
      "cpuCount": info.processorCount,
      "isLowRamDevice": info.physicalMemory < UInt64(3) * 1024 * 1024 * 1024,
    ])
  }
}
