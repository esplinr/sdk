extern crate libc;

use self::libc::c_char;
use claim_request::ClaimRequest;
use serde_json;

extern {
    fn indy_issuer_create_and_store_claim_def(command_handle: i32,
                                              wallet_handle: i32,
                                              issuer_did: *const c_char,
                                              schema_json: *const c_char,
                                              signature_type: *const c_char,
                                              create_non_revoc: bool,
                                              cb: Option<extern fn(xcommand_handle: i32, err: i32,
                                                                   claim_def_json: *const c_char)>) -> i32;
}


pub static CLAIM_REQ_STRING: &str =
    r#"{
           "msg_type":"CLAIM_REQUEST",
           "version":"0.1",
           "to_did":"BnRXf8yDMUwGyZVDkSENeq",
           "from_did":"GxtnGN6ypZYgEqcftSQFnC",
           "iid":"cCanHnpFAD",
           "mid":"",
           "blinded_ms":{
              "prover_did":"FQ7wPBUgSPnDGJnS1EYjTK",
              "u":"923...607",
              "ur":null
           },
           "issuer_did":"QTrbV4raAcND4DWWzBmdsh",
           "schema_seq_no":48,
           "optional_data":{
              "terms_of_service":"<Large block of text>",
              "price":6
           }
        }"#;

pub fn create_claim_request_from_str(s: &str) -> ClaimRequest{
    let claim_request_json:serde_json::Value = serde_json::from_str(s).unwrap();
    ClaimRequest::create_from_api_msg_json(&claim_request_json)
}

#[cfg(test)]
pub mod tests{
    use super::*;
    use utils::wallet::tests::make_wallet;
    use std::sync::mpsc::channel;
    use utils::callback::CallbackUtils;
    use utils::timeout::TimeoutUtils;
    use std::ffi::CString;
    use std::ptr::null;

    pub fn create_dummy_wallet(wallet_name: &str) -> Result<u32,u32>{
        make_wallet(wallet_name);
        Ok(0)
    }

    pub fn create_default_schema(schema_seq_no: u32) -> String {
        let schema = format!(r#"{{
                            "seqNo":{},
                            "data":{{
                                "name":"gvt",
                                "version":"1.0",
                                "keys":["age","sex","height","name"]
                            }}
                         }}"#, schema_seq_no);
        String::from(schema)
    }

    pub fn put_claim_def_in_issuer_wallet(issuer_did: &str, schema: &str, wallet_handle: i32) {
        let (issuer_create_claim_definition_sender, issuer_create_claim_definition_receiver) = channel();
        let issuer_create_claim_definition_closure = Box::new(move |err, claim_def_json| {
            issuer_create_claim_definition_sender.send((err, claim_def_json)).unwrap();
        });
        let (issuer_create_claim_definition_command_handle, create_claim_definition_callback) =
            CallbackUtils::
            closure_to_issuer_create_claim_definition_cb( issuer_create_claim_definition_closure);

        unsafe {
            let err =
                indy_issuer_create_and_store_claim_def(issuer_create_claim_definition_command_handle,
                                                       wallet_handle,
                                                       CString::new(issuer_did.clone()).unwrap().as_ptr(),
                                                       CString::new(schema.clone()).unwrap().as_ptr(),
                                                       null(),
                                                       false,
                                                       create_claim_definition_callback);
            assert_eq!(err,0);
        }
        let (err, claim_def_json) = issuer_create_claim_definition_receiver.recv_timeout(TimeoutUtils::long_timeout()).unwrap();
        info!("claim_def_json: {}", claim_def_json);
    }

}
