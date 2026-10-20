import Foundation
import Security

/**
 * Keeps the end-to-end encryption key in iCloud Keychain (a synchronizable keychain
 * item), so a reinstall or a new iPhone signed in to the same Apple ID restores it
 * without the user typing the recovery key. iCloud Keychain is end-to-end encrypted
 * by Apple; when it is off, the item stays on this device only.
 */
@objc(KeyBackup)
class KeyBackupModule: NSObject {

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  private let service = "com.vaultonotemobile.e2ee"

  private func baseQuery(_ account: String) -> [String: Any] {
    return [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrSynchronizable as String: kCFBooleanTrue as Any,
    ]
  }

  @objc(getStatus:rejecter:)
  func getStatus(
    _ resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    // Apps cannot read whether iCloud Keychain is on; a synchronizable item is the
    // best available and syncs whenever the user has it enabled.
    resolve(["available": true, "cloudEncrypted": FileManager.default.ubiquityIdentityToken != nil])
  }

  @objc(store:secret:resolver:rejecter:)
  func store(
    _ account: String,
    secret: String,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    let data = Data(secret.utf8)
    SecItemDelete(baseQuery(account) as CFDictionary)
    var add = baseQuery(account)
    add[kSecValueData as String] = data
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    let status = SecItemAdd(add as CFDictionary, nil)
    if status == errSecSuccess {
      resolve(["cloud": FileManager.default.ubiquityIdentityToken != nil])
    } else {
      reject("KEY_BACKUP_STORE_FAILED", "Keychain error \(status)", nil)
    }
  }

  @objc(retrieve:resolver:rejecter:)
  func retrieve(
    _ account: String,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    var query = baseQuery(account)
    query[kSecReturnData as String] = kCFBooleanTrue
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecSuccess, let data = item as? Data {
      resolve(String(data: data, encoding: .utf8))
    } else {
      resolve(nil)
    }
  }

  @objc(remove:resolver:rejecter:)
  func remove(
    _ account: String,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    let status = SecItemDelete(baseQuery(account) as CFDictionary)
    resolve(status == errSecSuccess || status == errSecItemNotFound)
  }
}
