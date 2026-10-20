#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(AudioTranscode, NSObject)

RCT_EXTERN_METHOD(convertToWav:(NSString *)inputUri
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
