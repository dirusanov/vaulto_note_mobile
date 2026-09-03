#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(DeviceCapabilities, NSObject)

RCT_EXTERN_METHOD(getCapabilities:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
