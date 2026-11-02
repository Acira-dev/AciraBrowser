// Public browser AuthenticationServices APIs. Private passkey material never
// leaves Apple's provider; only the website's credential response is returned.
#include "mac-passkeys.h"
#include <cstring>
#include <string>
#import <Cocoa/Cocoa.h>
#import <AuthenticationServices/AuthenticationServices.h>
#import <Security/Security.h>

static NSMutableDictionary *requests;
struct PasskeyWork { napi_env env; napi_deferred deferred; napi_threadsafe_function callback; };
static NSString *StringValue(napi_env env, napi_value value, size_t limit) {
  size_t size=0;
  if(napi_get_value_string_utf8(env,value,nullptr,0,&size)!=napi_ok||!size||size>limit)return nil;
  std::string text(size+1,'\0');napi_get_value_string_utf8(env,value,text.data(),text.size(),&size);
  return [[NSString alloc] initWithBytes:text.data() length:size encoding:NSUTF8StringEncoding];
}
static NSString *JSON(id value) {
  NSData *data=[NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}
static napi_value JSString(napi_env env, NSString *text) {
  napi_value value;napi_create_string_utf8(env,text.UTF8String,NAPI_AUTO_LENGTH,&value);return value;
}
static NSDictionary *Support() {
  static NSDictionary *cached;
  if(cached)return cached; // The running app's signature/profile needs a relaunch to change.
  bool supported=false,entitled=false;
  if(@available(macOS 13.5,*))supported=true;
  SecCodeRef code=nullptr;CFDictionaryRef information=nullptr;
  if(SecCodeCopySelf(kSecCSDefaultFlags,&code)==errSecSuccess&&
     SecCodeCopySigningInformation(code,kSecCSSigningInformation,&information)==errSecSuccess){
    NSDictionary *info=(__bridge NSDictionary *)information;
    NSDictionary *values=info[(__bridge NSString *)kSecCodeInfoEntitlementsDict];
    NSString *application=values[@"com.apple.application-identifier"],*team=info[(__bridge NSString *)kSecCodeInfoTeamIdentifier];
    NSString *bundle=NSBundle.mainBundle.bundleIdentifier;
    BOOL profile=[NSFileManager.defaultManager fileExistsAtPath:[NSBundle.mainBundle.bundlePath stringByAppendingPathComponent:@"Contents/embedded.provisionprofile"]];
    // A flag in a configuration file is never enough: inspect the running
    // process's actual signed entitlement, identifier, profile and signature.
    entitled=[values[@"com.apple.developer.web-browser.public-key-credential"] isEqual:@YES]&&
      team.length&&bundle.length&&[application isEqual:[NSString stringWithFormat:@"%@.%@",team,bundle]]&&profile&&
      SecCodeCheckValidity(code,kSecCSStrictValidate,nullptr)==errSecSuccess;
  }
  if(information)CFRelease(information);if(code)CFRelease(code);
  cached=@{@"supported":@(supported),@"entitled":@(entitled),@"available":@(supported&&entitled)};
  return cached;
}
static NSData *Decode(NSString *text) {
  if(![text isKindOfClass:NSString.class])return nil;
  NSString *value=[[text stringByReplacingOccurrencesOfString:@"-" withString:@"+"] stringByReplacingOccurrencesOfString:@"_" withString:@"/"];
  while(value.length%4)value=[value stringByAppendingString:@"="];
  return [[NSData alloc] initWithBase64EncodedString:value options:0];
}
static NSString *Encode(NSData *data) {
  return [[[[data base64EncodedStringWithOptions:0] stringByReplacingOccurrencesOfString:@"+" withString:@"-"] stringByReplacingOccurrencesOfString:@"/" withString:@"_"] stringByReplacingOccurrencesOfString:@"=" withString:@""];
}
static void Deliver(napi_env env,napi_value function,void *context,void *data) {
  auto *text=static_cast<std::string *>(data);
  if(env){auto *work=static_cast<PasskeyWork *>(context);napi_value value;napi_create_string_utf8(env,text->data(),text->size(),&value);napi_resolve_deferred(env,work->deferred,value);}
  delete text;
}
static void Finalize(napi_env env,void *data,void *hint){delete static_cast<PasskeyWork *>(data);}

API_AVAILABLE(macos(13.5))
@interface AciraPasskeyRequest : NSObject <ASAuthorizationControllerDelegate,ASAuthorizationControllerPresentationContextProviding>
@property(nonatomic) PasskeyWork *work;
@property(nonatomic,strong) NSString *token;
@property(nonatomic,strong) NSDictionary *input;
@property(nonatomic,strong) NSWindow *window;
@property(nonatomic,strong) ASAuthorizationController *controller;
@property(nonatomic) BOOL completed;
- (void)begin;
- (void)cancel;
- (void)finish:(NSDictionary *)result;
@end

@implementation AciraPasskeyRequest
- (void)finish:(NSDictionary *)result {
  if(self.completed)return;self.completed=YES;
  PasskeyWork *work=self.work;self.work=nullptr;
  NSString *json=JSON(result);
  auto *text=new std::string(json.UTF8String?:"{\"ok\":false}");
  if(napi_call_threadsafe_function(work->callback,text,napi_tsfn_nonblocking)!=napi_ok)delete text;
  napi_release_threadsafe_function(work->callback,napi_tsfn_release);
  // Keep the delegate alive until this callback returns, including synchronous
  // cancellation paths. Late authorization callbacks see completed and stop.
  dispatch_async(dispatch_get_main_queue(),^{[requests removeObjectForKey:self.token];self.controller=nil;self.window=nil;});
}
- (void)cancel {
  [self finish:@{@"ok":@NO,@"name":@"AbortError"}];
  [self.controller cancel];
}
- (ASPresentationAnchor)presentationAnchorForAuthorizationController:(ASAuthorizationController *)controller{return self.window;}
- (void)perform {
  if(self.completed||!self.window.isVisible){if(!self.completed)[self finish:@{@"ok":@NO}];return;}
  NSDictionary *input=self.input;
  ASPublicKeyCredentialClientData *client=[[ASPublicKeyCredentialClientData alloc] initWithChallenge:Decode(input[@"challenge"]) origin:input[@"origin"]];
  client.crossOrigin=ASPublicKeyCredentialClientDataCrossOriginValueSameOriginWithAncestors;
  ASAuthorizationPlatformPublicKeyCredentialProvider *provider=[[ASAuthorizationPlatformPublicKeyCredentialProvider alloc] initWithRelyingPartyIdentifier:input[@"rpId"]];
  NSMutableArray *descriptors=[NSMutableArray array];
  for(NSString *identifier in input[@"credentials"])[descriptors addObject:[[ASAuthorizationPlatformPublicKeyCredentialDescriptor alloc] initWithCredentialID:Decode(identifier)]];
  ASAuthorizationRequest *request;
  if([input[@"operation"] isEqual:@"create"]){
    NSDictionary *user=input[@"user"];
    ASAuthorizationPlatformPublicKeyCredentialRegistrationRequest *registration=[provider createCredentialRegistrationRequestWithClientData:client name:user[@"name"] userID:Decode(user[@"id"])];
    registration.excludedCredentials=descriptors;
    registration.userVerificationPreference=input[@"userVerification"];
    registration.attestationPreference=ASAuthorizationPublicKeyCredentialAttestationKindNone;
    request=registration;
  }else{
    ASAuthorizationPlatformPublicKeyCredentialAssertionRequest *assertion=[provider createCredentialAssertionRequestWithClientData:client];
    assertion.allowedCredentials=descriptors;assertion.userVerificationPreference=input[@"userVerification"];
    request=assertion;
  }
  self.controller=[[ASAuthorizationController alloc] initWithAuthorizationRequests:@[request]];
  self.controller.delegate=self;self.controller.presentationContextProvider=self;
  [self.controller performRequests];
}
- (void)begin {
  ASAuthorizationWebBrowserPublicKeyCredentialManager *manager=[ASAuthorizationWebBrowserPublicKeyCredentialManager new];
  switch(manager.authorizationStateForPlatformCredentials){
    case ASAuthorizationWebBrowserPublicKeyCredentialManagerAuthorizationStateAuthorized:[self perform];break;
    case ASAuthorizationWebBrowserPublicKeyCredentialManagerAuthorizationStateDenied:[self finish:@{@"ok":@NO}];break;
    default:
      [manager requestAuthorizationForPublicKeyCredentials:^(ASAuthorizationWebBrowserPublicKeyCredentialManagerAuthorizationState state){
        dispatch_async(dispatch_get_main_queue(),^{if(self.completed)return;if(state==ASAuthorizationWebBrowserPublicKeyCredentialManagerAuthorizationStateAuthorized)[self perform];else [self finish:@{@"ok":@NO}];});
      }];break;
  }
}
- (void)authorizationController:(ASAuthorizationController *)controller didCompleteWithAuthorization:(ASAuthorization *)authorization {
  if(self.completed)return;
  id credential=authorization.credential;
  if([credential isKindOfClass:ASAuthorizationPlatformPublicKeyCredentialAssertion.class]){
    ASAuthorizationPlatformPublicKeyCredentialAssertion *value=credential;
    [self finish:@{@"ok":@YES,@"credential":@{@"id":Encode(value.credentialID),@"clientDataJSON":Encode(value.rawClientDataJSON),
      @"authenticatorData":Encode(value.rawAuthenticatorData),@"signature":Encode(value.signature),@"userHandle":value.userID?Encode(value.userID):(id)NSNull.null,
      @"attachment":value.attachment==ASAuthorizationPublicKeyCredentialAttachmentPlatform?@"platform":@"cross-platform"}}];
  }else if([credential isKindOfClass:ASAuthorizationPlatformPublicKeyCredentialRegistration.class]){
    ASAuthorizationPlatformPublicKeyCredentialRegistration *value=credential;
    if(!value.rawAttestationObject){[self finish:@{@"ok":@NO}];return;}
    [self finish:@{@"ok":@YES,@"credential":@{@"id":Encode(value.credentialID),@"clientDataJSON":Encode(value.rawClientDataJSON),
      @"attestationObject":Encode(value.rawAttestationObject),@"attachment":value.attachment==ASAuthorizationPublicKeyCredentialAttachmentPlatform?@"platform":@"cross-platform"}}];
  }else [self finish:@{@"ok":@NO}];
}
- (void)authorizationController:(ASAuthorizationController *)controller didCompleteWithError:(NSError *)error {
  // No account names or system-localized errors cross the IPC boundary.
  BOOL excluded=([error.domain isEqual:ASAuthorizationErrorDomain]&&error.code==1006)||([error.domain isEqual:@"WKErrorDomain"]&&error.code==8);
  [self finish:@{@"ok":@NO,@"name":excluded?@"InvalidStateError":@"NotAllowedError"}];
}
@end

static napi_value Available(napi_env env,napi_callback_info info){@autoreleasepool{return JSString(env,JSON(Support()));}}
static napi_value Start(napi_env env,napi_callback_info info){
 @autoreleasepool {
  size_t argc=2,length=0;void *bytes=nullptr;bool buffer=false;napi_value args[2];
  napi_get_cb_info(env,info,&argc,args,nullptr,nullptr);
  if(argc==2)napi_is_buffer(env,args[0],&buffer);
  NSString *json=argc==2?StringValue(env,args[1],128*1024):nil;
  NSDictionary *input=json?[NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]:nil;
  if(![NSThread isMainThread]||!buffer||napi_get_buffer_info(env,args[0],&bytes,&length)!=napi_ok||length!=sizeof(void *)||![input isKindOfClass:NSDictionary.class]){napi_throw_type_error(env,nullptr,"Invalid native passkey request");return nullptr;}
  napi_deferred deferred;napi_value promise;napi_create_promise(env,&deferred,&promise);
  auto refuse=[&](){napi_resolve_deferred(env,deferred,JSString(env,@"{\"ok\":false,\"name\":\"NotAllowedError\"}"));};
  if(![Support()[@"available"] boolValue]||requests.count){refuse();return promise;}
  if(@available(macOS 13.5,*)){
    uintptr_t pointer=0;std::memcpy(&pointer,bytes,sizeof(pointer));
    NSView *view=pointer?(__bridge NSView *)(reinterpret_cast<void *>(pointer)):nil;
    if(!view.window||!view.window.isVisible||![input[@"id"] isKindOfClass:NSString.class]||[input[@"id"] length]!=36){refuse();return promise;}
    auto *work=new PasskeyWork;work->env=env;work->deferred=deferred;
    napi_value name;napi_create_string_utf8(env,"Acira native browser passkey",NAPI_AUTO_LENGTH,&name);
    if(napi_create_threadsafe_function(env,nullptr,nullptr,name,1,1,work,Finalize,work,Deliver,&work->callback)!=napi_ok){delete work;refuse();return promise;}
    napi_unref_threadsafe_function(env,work->callback);
    AciraPasskeyRequest *request=[AciraPasskeyRequest new];request.work=work;request.token=input[@"id"];request.input=input;request.window=view.window;
    if(!requests)requests=[NSMutableDictionary dictionary];requests[request.token]=request;
    [request begin];
  }else refuse();
  return promise;
 }
}
static napi_value Cancel(napi_env env,napi_callback_info info){
  size_t argc=1;napi_value args[1];napi_get_cb_info(env,info,&argc,args,nullptr,nullptr);
  if([NSThread isMainThread]&&argc){NSString *token=StringValue(env,args[0],36);if(token){if(@available(macOS 13.5,*))[(AciraPasskeyRequest *)requests[token] cancel];}}
  napi_value value;napi_get_undefined(env,&value);return value;
}
static void Cleanup(void *context){
  if(![NSThread isMainThread])return;
  if(@available(macOS 13.5,*))for(AciraPasskeyRequest *request in requests.allValues){
    PasskeyWork *work=request.work;
    if(!work||work->env!=context)continue;
    request.completed=YES;request.work=nullptr;
    napi_release_threadsafe_function(work->callback,napi_tsfn_abort);
    [request.controller cancel];[requests removeObjectForKey:request.token];
  }
}
void InstallMacPasskeys(napi_env env,napi_value exports){
  napi_add_env_cleanup_hook(env,Cleanup,env);
  for(auto entry:{std::pair<const char *,napi_callback>{"passkeySupport",Available},{"passkeyStart",Start},{"passkeyCancel",Cancel}}){napi_value fn;napi_create_function(env,entry.first,NAPI_AUTO_LENGTH,entry.second,nullptr,&fn);napi_set_named_property(env,exports,entry.first,fn);}
}
